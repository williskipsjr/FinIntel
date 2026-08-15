//! Background worker: runs the ingestion pipeline per uploaded statement and
//! keeps the DB-backed job row up to date (queued -> processing -> completed |
//! failed) so the status endpoint reflects reality.

use reqwest::Client;
use serde_json::{json, Value};
use sqlx::PgPool;
use tokio::sync::mpsc::Receiver;

use crate::{
    config::service_config::ServiceConfig,
    models::{
        entity::CanonicalEntity,
        statement::ProcessingJob,
        transaction::Transaction,
    },
    repositories::{job_repository::update_job, statement::update_statement_status},
    services::{entity_service::save_entities, transaction_service::save_transactions},
};

pub async fn start_worker(
    mut receiver: Receiver<ProcessingJob>,
    db: PgPool,
    services: ServiceConfig,
) {
    let client = Client::new();

    while let Some(job) = receiver.recv().await {
        println!("\nProcessing statement: {}", job.statement_id);

        match process_job(&client, &db, &services, &job).await {
            Ok(()) => {
                update_job(&db, job.job_id, "completed", 100, "done", None).await;
                let _ = update_statement_status(&db, job.statement_id, "completed").await;
                println!("Job {} completed", job.job_id);
            }
            Err(err) => {
                update_job(&db, job.job_id, "failed", 0, "error", Some(&err)).await;
                let _ = update_statement_status(&db, job.statement_id, "failed").await;
                println!("Job {} FAILED: {}", job.job_id, err);
            }
        }
    }
}

async fn process_job(
    client: &Client,
    db: &PgPool,
    services: &ServiceConfig,
    job: &ProcessingJob,
) -> Result<(), String> {
    update_job(db, job.job_id, "processing", 10, "ocr", None).await;
    let _ = update_statement_status(db, job.statement_id, "processing").await;

    let abs_path = std::fs::canonicalize(&job.file_path)
        .map_err(|e| format!("path error: {}", e))?
        .to_string_lossy()
        .to_string();

    // 1. OCR / extraction
    let ocr =
        post(client, &endpoint(&services.ocr, "/extract"), &json!({ "file_path": abs_path })).await?;

    // 2. standardize
    update_job(db, job.job_id, "processing", 30, "standardize", None).await;
    let standardized = post(
        client,
        &endpoint(&services.standardize, "/standardize"),
        &json!({ "rows": ocr["rows"] }),
    )
    .await?;

    // 3. validate
    update_job(db, job.job_id, "processing", 45, "validate", None).await;
    let validated = post(
        client,
        &endpoint(&services.validation, "/validate"),
        &json!({ "transactions": standardized["transactions"] }),
    )
    .await?;

    // 4. persist transactions
    let txns: Vec<Transaction> =
        serde_json::from_value(validated["transactions"].clone()).unwrap_or_default();
    println!("Saving {} transactions", txns.len());
    save_transactions(db, job.statement_id, txns).await;

    // 5. entities
    update_job(db, job.job_id, "processing", 65, "entities", None).await;
    let entity_resp = post(
        client,
        &endpoint(&services.entity, "/resolve"),
        &json!({ "transactions": validated["transactions"] }),
    )
    .await?;
    let entities: Vec<CanonicalEntity> =
        serde_json::from_value(entity_resp["canonical_entities"].clone()).unwrap_or_default();
    save_entities(db, entities).await;

    // 6. graph intelligence (DB-driven, whole network) — best-effort.
    // A new statement changes every whole-network aggregate, so drop all cached
    // analysis first (graph analyze/risk + report all share `analysis_cache`);
    // the refreshing call below then re-warms the analyze cache.
    update_job(db, job.job_id, "processing", 85, "graph", None).await;
    if let Err(e) = crate::repositories::delete_repository::clear_analysis_cache(db).await {
        println!("Cache invalidation failed (non-fatal): {:?}", e);
    }
    let graph_analyze = endpoint(&services.graph, "/flow/analyze/all?refresh=true");
    match get(client, &graph_analyze).await {
        Ok(g) => {
            let trips = g["round_trips"].as_array().map(|a| a.len()).unwrap_or(0);
            println!("Graph intelligence refreshed (round-trips: {})", trips);
        }
        Err(e) => println!("Graph trigger failed (non-fatal): {}", e),
    }

    // 7. raise investigator alerts for serious findings (best-effort)
    generate_alerts(client, db, services, job.statement_id).await;

    Ok(())
}

// Balanced-sensitivity alerting: HIGH/CRITICAL accounts + any round-trip in this
// statement. Best-effort — an alerting hiccup never fails the ingestion job.
async fn generate_alerts(
    client: &Client,
    db: &PgPool,
    services: &ServiceConfig,
    statement_id: uuid::Uuid,
) {
    use crate::repositories::alert_repository::insert_alert;

    // account-level HIGH/CRITICAL alerts
    let risk_url = format!(
        "{}/risk/top/statement/{}?limit=20",
        services.graph.trim_end_matches('/'),
        statement_id
    );
    if let Ok(v) = get(client, &risk_url).await {
        if let Some(arr) = v["top_risks"].as_array() {
            for r in arr {
                let level = r["risk_level"].as_str().unwrap_or("LOW");
                if level != "HIGH" && level != "CRITICAL" {
                    continue;
                }
                let account = r["node"].as_str().or_else(|| r["account"].as_str());
                let category = r["tags"]
                    .as_array()
                    .and_then(|t| t.first())
                    .and_then(|t| t["key"].as_str())
                    .unwrap_or(if level == "CRITICAL" { "MALICIOUS" } else { "HIGH_RISK" });
                let reasons: Vec<String> = r["top_reasons"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                let title = format!("{} risk account: {}", level, account.unwrap_or("unknown"));
                let detail = reasons.join("; ");
                if let Err(e) =
                    insert_alert(db, statement_id, account, level, category, &title, &detail).await
                {
                    println!("alert insert failed (non-fatal): {:?}", e);
                }
            }
        }
    }

    // one summary alert if the statement contains circular money flow
    let flow_url = format!(
        "{}/flow/analyze/statement/{}",
        services.graph.trim_end_matches('/'),
        statement_id
    );
    if let Ok(v) = get(client, &flow_url).await {
        if let Some(rt) = v["round_trips"].as_array() {
            if !rt.is_empty() {
                let title = format!("Circular money flow detected ({} chain(s))", rt.len());
                let _ = insert_alert(
                    db,
                    statement_id,
                    None,
                    "HIGH",
                    "CIRCULAR",
                    &title,
                    "Round-trip / circular transfers found in this statement.",
                )
                .await;
            }
        }
    }
}

fn endpoint(base: &str, path: &str) -> String {
    format!("{}{}", base.trim_end_matches('/'), path)
}

async fn post(client: &Client, url: &str, body: &Value) -> Result<Value, String> {
    let resp = client
        .post(url)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("{} request error: {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!("{} returned {}", url, resp.status()));
    }
    resp.json::<Value>()
        .await
        .map_err(|e| format!("{} bad JSON: {}", url, e))
}

async fn get(client: &Client, url: &str) -> Result<Value, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{} request error: {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!("{} returned {}", url, resp.status()));
    }
    resp.json::<Value>()
        .await
        .map_err(|e| format!("{} bad JSON: {}", url, e))
}
