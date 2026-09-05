//! Investigation endpoints — the gateway proxies to the graph (money-flow,
//! round-trips, clusters, risk, investigation) and trail (FIFO money-trail)
//! services, wrapping every result in the standard envelope.
//!
//! `case_id` semantics: "all" = the whole transaction network; a statement
//! UUID scopes round-trips / money-flow / clusters to that statement.

use axum::extract::{Path, Query, State};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    api::{ApiResponse, ApiResult, AppError},
    repositories::read_repository,
    services::proxy::get_json,
    state::app_state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct InvQuery {
    pub limit: Option<i64>,
    pub account: Option<String>,
}

fn enc(seg: &str) -> String {
    seg.replace(' ', "%20").replace('#', "%23").replace('?', "%3F")
}

// ----- money-flow / round-trips / clusters ------------------------------

pub async fn money_flow(
    State(state): State<AppState>,
    Path(case_id): Path<String>,
) -> ApiResult<Value> {
    let g = &state.services.graph;
    let data = if case_id == "all" {
        get_json(&state.http_client, &format!("{}/flow/money-flow/all", g)).await?
    } else {
        let v = get_json(
            &state.http_client,
            &format!("{}/flow/analyze/statement/{}", g, enc(&case_id)),
        )
        .await?;
        json!({
            "summary": v.get("summary").cloned().unwrap_or(Value::Null),
            "nodes": v.pointer("/graph/nodes").cloned().unwrap_or(json!([])),
            "edges": v.pointer("/graph/edges").cloned().unwrap_or(json!([])),
        })
    };
    Ok(ApiResponse::success(data))
}

pub async fn round_trips(
    State(state): State<AppState>,
    Path(case_id): Path<String>,
) -> ApiResult<Value> {
    let g = &state.services.graph;
    let data = if case_id == "all" {
        get_json(&state.http_client, &format!("{}/flow/round-trips/all", g)).await?
    } else {
        let v = get_json(
            &state.http_client,
            &format!("{}/flow/analyze/statement/{}", g, enc(&case_id)),
        )
        .await?;
        json!({ "round_trips": v.get("round_trips").cloned().unwrap_or(json!([])) })
    };
    Ok(ApiResponse::success(data))
}

pub async fn clusters(
    State(state): State<AppState>,
    Path(case_id): Path<String>,
) -> ApiResult<Value> {
    let g = &state.services.graph;
    let data = if case_id == "all" {
        get_json(&state.http_client, &format!("{}/flow/clusters/all", g)).await?
    } else {
        let v = get_json(
            &state.http_client,
            &format!("{}/flow/analyze/statement/{}", g, enc(&case_id)),
        )
        .await?;
        json!({ "communities": v.get("communities").cloned().unwrap_or(json!([])) })
    };
    Ok(ApiResponse::success(data))
}

// ----- money-trail (Core Req 5) -----------------------------------------

pub async fn money_trail(
    State(state): State<AppState>,
    Path((_case_id, transaction_id)): Path<(String, String)>,
) -> ApiResult<Value> {
    let url = format!(
        "{}/trail/transaction/{}",
        state.services.trail,
        enc(&transaction_id)
    );
    let data = get_json(&state.http_client, &url).await?;
    Ok(ApiResponse::success(data))
}

// ----- investigation views ----------------------------------------------

pub async fn top_suspicious(
    State(state): State<AppState>,
    Path(case_id): Path<String>,
    Query(q): Query<InvQuery>,
) -> ApiResult<Value> {
    let limit = q.limit.unwrap_or(20);
    let g = &state.services.graph;
    let url = if case_id == "all" {
        // representative whole-network view: every statement is guaranteed a
        // seat so smaller statements aren't buried by global normalization
        format!("{}/investigation/top-suspicious/representative?limit={}", g, limit)
    } else {
        // scope strictly to the selected statement — no leakage from others
        format!(
            "{}/investigation/top-suspicious/statement/{}?limit={}",
            g,
            enc(&case_id),
            limit
        )
    };
    Ok(ApiResponse::success(get_json(&state.http_client, &url).await?))
}

pub async fn top_risks(
    State(state): State<AppState>,
    Path(case_id): Path<String>,
    Query(q): Query<InvQuery>,
) -> ApiResult<Value> {
    let limit = q.limit.unwrap_or(20);
    let g = &state.services.graph;
    let url = if case_id == "all" {
        format!("{}/risk/top/representative?limit={}", g, limit)
    } else {
        format!("{}/risk/top/statement/{}?limit={}", g, enc(&case_id), limit)
    };
    Ok(ApiResponse::success(get_json(&state.http_client, &url).await?))
}

pub async fn timeline(
    State(state): State<AppState>,
    Path(_case_id): Path<String>,
    Query(q): Query<InvQuery>,
) -> ApiResult<Value> {
    let account = q
        .account
        .ok_or_else(|| AppError::Validation("'account' query parameter is required".into()))?;
    let url = format!(
        "{}/investigation/timeline/{}",
        state.services.graph,
        enc(&account)
    );
    Ok(ApiResponse::success(get_json(&state.http_client, &url).await?))
}

pub async fn counterparties(
    State(state): State<AppState>,
    Path(_case_id): Path<String>,
    Query(q): Query<InvQuery>,
) -> ApiResult<Value> {
    let account = q
        .account
        .ok_or_else(|| AppError::Validation("'account' query parameter is required".into()))?;
    let url = format!(
        "{}/investigation/counterparties/{}",
        state.services.graph,
        enc(&account)
    );
    Ok(ApiResponse::success(get_json(&state.http_client, &url).await?))
}

// ----- entity risk / explanation ----------------------------------------

pub async fn entity_risk_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let entity = read_repository::get_entity(&state.db, &id).await?;
    let identifier = entity
        .get("identifier")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::NotFound("entity has no identifier".into()))?;
    let url = format!(
        "{}/risk/account/{}",
        state.services.graph,
        enc(identifier)
    );
    Ok(ApiResponse::success(get_json(&state.http_client, &url).await?))
}

pub async fn entity_explanation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let entity = read_repository::get_entity(&state.db, &id).await?;
    let identifier = entity
        .get("identifier")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::NotFound("entity has no identifier".into()))?;
    let url = format!(
        "{}/explain/account/{}",
        state.services.graph,
        enc(identifier)
    );
    let mut explanation = get_json(&state.http_client, &url).await?;
    if let Value::Object(ref mut m) = explanation {
        m.insert("entity_id".into(), json!(id));
    }
    Ok(ApiResponse::success(explanation))
}

/// GET /api/v1/investigations/{case_id}/round-trips/{chain_id}/explanation
///
/// `chain_id` is only stable within the scope it was listed in (see
/// `round_trips` above), so the explanation must be rebuilt from the SAME
/// scope — forwarding `case_id` here (previously dropped) is what makes
/// chain_id 0..N in a single-statement view resolve to that statement's own
/// cycle #N instead of an unrelated whole-network cycle #N.
pub async fn round_trip_explanation(
    State(state): State<AppState>,
    Path((case_id, chain_id)): Path<(String, String)>,
) -> ApiResult<Value> {
    let url = format!(
        "{}/explain/round-trip/{}?case_id={}",
        state.services.graph,
        enc(&chain_id),
        enc(&case_id)
    );
    Ok(ApiResponse::success(get_json(&state.http_client, &url).await?))
}
