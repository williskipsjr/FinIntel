use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::services::service_checker::check_service;
use crate::state::AppState;

pub async fn health() -> Json<Value> {
    Json(json!({
        "status": "healthy",
        "service": "finintel-backend"
    }))
}

pub async fn test_ocr(State(state): State<AppState>) -> Json<Value> {
    match reqwest::get(format!("{}/health", state.services.ocr)).await {
        Ok(response) => {
            let body: Value = response.json().await.unwrap_or_else(|_| json!({}));
            Json(json!({
                "backend_status": "success",
                "ocr_response": body
            }))
        }
        Err(err) => {
            Json(json!({
                "backend_status": "error",
                "message": err.to_string()
            }))
        }
    }
}

pub async fn services_health(State(state): State<AppState>) -> Json<Value> {
    let s = &state.services;
    let (
        ocr,
        standardize,
        entity,
        validation,
        graph,
        anomaly,
        temporal,
        trail,
        report,
    ) = tokio::join!(
        check_service(&s.ocr),
        check_service(&s.standardize),
        check_service(&s.entity),
        check_service(&s.validation),
        check_service(&s.graph),
        check_service(&s.anomaly),
        check_service(&s.temporal),
        check_service(&s.trail),
        check_service(&s.report),
    );

    let all_healthy = [
        &ocr,
        &standardize,
        &entity,
        &validation,
        &graph,
        &anomaly,
        &temporal,
        &trail,
        &report,
    ]
    .iter()
    .all(|s| s["status"] == "healthy");

    Json(json!({
        "system_status": if all_healthy { "healthy" } else { "degraded" },
        "backend": {
            "service": "finintel-backend",
            "status": "healthy"
        },
        "services": {
            "ocr": ocr,
            "standardize": standardize,
            "entity": entity,
            "validation": validation,
            "graph": graph,
            "anomaly": anomaly,
            "temporal": temporal,
            "trail": trail,
            "report": report
        }
    }))
}