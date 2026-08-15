mod api;
mod config;
mod routes;
mod handlers;
mod services;
mod models;
mod repositories;
mod state;

use std::{
    collections::HashMap,
    sync::Arc,
};

use axum::Router;
use dotenvy::dotenv;
use sqlx::postgres::PgPoolOptions;
use tokio::{
    sync::{
        mpsc,
        RwLock,
    },
};

use tower_http::cors::CorsLayer;

use routes::{
    api_routes::api_routes,
    health_routes::health_routes,
};

use config::service_config::ServiceConfig;
use services::worker::start_worker;

use state::{
    app_state::AppState,
    job_status::JobStatusStore,
};

#[tokio::main]
async fn main() {
    // Load .env
    dotenv().ok();

    // Initialize logging
    tracing_subscriber::fmt::init();

    // Database URL
    let database_url =
        std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/finintel".into());

    println!(
        "\nDATABASE_URL = {}\n",
        database_url
    );

    // Create PostgreSQL pool
    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("Failed to connect to PostgreSQL");

    println!("PostgreSQL Connected");

    // Current database
    let db_name: (String,) =
        sqlx::query_as(
            "SELECT current_database()"
        )
        .fetch_one(&db)
        .await
        .unwrap();

    println!(
        "CONNECTED DATABASE = {}",
        db_name.0
    );

    // Current schema
    let schema_name: (String,) =
        sqlx::query_as(
            "SELECT current_schema()"
        )
        .fetch_one(&db)
        .await
        .unwrap();

    println!(
        "CURRENT SCHEMA = {}",
        schema_name.0
    );

    // Existing statement count
    let statement_count: (i64,) =
        sqlx::query_as(
            "SELECT COUNT(*) FROM statements"
        )
        .fetch_one(&db)
        .await
        .unwrap();

    println!(
        "STATEMENTS IN DB = {}",
        statement_count.0
    );

    // Existing transaction count
    let transaction_count: (i64,) =
        sqlx::query_as(
            "SELECT COUNT(*) FROM transactions"
        )
        .fetch_one(&db)
        .await
        .unwrap();

    println!(
        "TRANSACTIONS IN DB = {}",
        transaction_count.0
    );

    // Create queue
    let (job_sender, job_receiver) =
        mpsc::channel(100);

    // Create in-memory job status store
    let job_status: JobStatusStore =
        Arc::new(
            RwLock::new(HashMap::new())
        );

    let services = ServiceConfig::from_env();

    // Start background worker
    tokio::spawn(
        start_worker(
            job_receiver,
            db.clone(),
            services.clone(),
        )
    );

    println!("Background Worker Started");

    // Create application state
    let app_state = AppState {
        db,
        http_client: reqwest::Client::new(),
        job_sender,
        job_status,
        services,
    };

    // CORS so the frontend (different origin/port) can call the backend.
    // Permissive in dev; tighten with allow_origin(...) for production.
    let cors = CorsLayer::permissive();

    // Build router (root health routes + versioned /api/v1 surface + /docs)
    let app = Router::new()
        .merge(health_routes())
        .merge(api_routes())
        .layer(cors)
        .with_state(app_state);

    // Start server
    let listener =
        tokio::net::TcpListener::bind(
            "0.0.0.0:8080"
        )
        .await
        .expect("Failed to bind to port 8080");

    println!(
        "FinIntel Backend running on http://localhost:8080"
    );

    axum::serve(listener, app)
        .await
        .expect("Server failed");
}
