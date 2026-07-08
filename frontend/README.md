# FinIntel Investigator Workspace — Frontend Developer Documentation

This document provides a comprehensive overview of the **FinIntel React Frontend**, including its visual design system, layout standards, routing structure, state management, API integration, and user workflows.

---

## Visual Design System & Aesthetics

The FinIntel Investigator Workspace uses a bespoke, premium **dark theme** optimized for law enforcement officers and forensic analysts who require high scannability during long investigation sessions.

### 1. Typography & Hierarchy
*   **Font Families:** Primary typography is set to [Outfit](https://fonts.google.com/specimen/Outfit) (for sleek headers, scores, and metrics) paired with [Inter](https://fonts.google.com/specimen/Inter) (for highly legible data grids and transaction details).
*   **Size Scales:** Curated typographic scale from micro-labels (`0.75rem`) up to hero statistics (`2.5rem`) with generous line-heights to prevent grid fatigue.

### 2. Core Color Palette (HSL & Transparency)
Designed using tailored HSL color tokens for seamless alpha transparency overlays:
*   `--background`: `240 10% 3.9%` (Deep Obsidian Black)
*   `--card`: `240 10% 6%` (Subtle dark gray panels)
*   `--primary`: `263.4 70% 50.4%` (High-contrast Neon Violet)
*   `--accent`: `280 80% 60%` (Vibrant Indigo-Purple accents)
*   `--risk-high`: `0 84.2% 60.2%` (Alert Red)
*   `--risk-medium`: `38 92% 50%` (Caution Amber)
*   `--risk-low`: `142.1 76.2% 36.3%` (Safe Emerald Green)

### 3. Visual Components & Styling
*   **Glassmorphism Panels:** Main cards use semi-transparent backdrops (`background: rgba(15, 15, 20, 0.65)`) with a backdrop blur filter (`backdrop-filter: blur(12px)`) and thin, light-emitting borders (`border: 1px solid rgba(255, 255, 255, 0.08)`).
*   **Emulated Window Controls:** Interactive cards and workspace modules feature a macOS-style window controls header (trio of flat red, yellow, and green circular dots) to convey a native application workspace feel.
*   **Micro-Animations:** Clean CSS transitions (`transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1)`) applied to hover states, sidebar links, list items, and upload dropzones for fluid visual response.

---

## Routing Schema & Workspace Layout

The application's client-side routing is declared inside [App.tsx](file:///C:/Users/Willis/OneDrive/Documents/Hackathons/CIDECODE/AI-Powered-Financial-Crime-Investigation-Platform/frontend/src/App.tsx) using `react-router-dom` v6. 

### 1. Main Navigation Hierarchy
*   **Public Portal Landing:** `/` — Interactive promotional entry point demonstrating the platform value and core capabilities.
*   **Identity Verification:** `/login` — Secure entry point to authenticate investigators and load workspace states.
*   **Investigator Workspace:** `/workspace` — The central, authenticated dashboard layout. All core analytical views render inside the `/workspace` layout container.

### 2. Workspace Subpages (Sub-routes)
Nested within the [WorkspaceLayout](file:///C:/Users/Willis/OneDrive/Documents/Hackathons/CIDECODE/AI-Powered-Financial-Crime-Investigation-Platform/frontend/src/components/WorkspaceLayout.tsx) layout shell:
*   **Overview Dashboard:** `/workspace` — Ingestion dropzone, active statements list, active case info, and system health status monitor.
*   **Round-Trips Analysis:** `/workspace/round-trips` — Displays detected circular-flow/layering loops with path lengths, transaction logs, and LLM-generated narrative summaries.
*   **Money-Flow Graph:** `/workspace/money-flow` — Force-directed entity-relationship network visualizer showing cash accumulation, layering, and transfer pipelines.
*   **Money-Trail Tracking:** `/workspace/money-trail` — Traces credit deposits down to their component debits in sequence using FIFO flow tracking.
*   **Investigation Reports:** `/workspace/reports` — Generate, customize, email, or download full-scale DOCX, PDF, and Excel reports.
*   **System Settings:** `/workspace/settings` — Configure database connection strings, model parameters, API endpoints, and clean mock databases.

---

## Global State Management & API Integration

### 1. Unified Client-Side Data Context
Global application state is managed by the React Context API declared in [FinintelDataContext.tsx](file:///C:/Users/Willis/OneDrive/Documents/Hackathons/CIDECODE\AI-Powered-Financial-Crime-Investigation-Platform/frontend/src/context/FinintelDataContext.tsx) and accessed via the custom hook `useFinintelData()`.

*   **Context Scope:** Manages statement metadata lists, actively selected transactions, current case parameters, report configurations, backend endpoint configuration, and ingestion job polling queues.
*   **Active Statement Hydration:** Triggers automated UI-wide refreshes when statements are deleted, uploaded, or completed, ensuring consistent visualizations across the money flow network graph and FIFO trails.

### 2. API Communication Layer
All HTTP calls are encapsulated in [finintelApi.ts](file:///C:/Users/Willis/OneDrive/Documents/Hackathons/CIDECODE/AI-Powered-Financial-Crime-Investigation-Platform/frontend/src/services/finintelApi.ts).

*   **Async Ingestion Flow:** When a document is dragged into the dropzone:
    1.  `uploadStatement()` sends the file to the backend gateway `/statements/upload`.
    2.  The gateway returns a unique background job UUID.
    3.  The frontend initiates a polling loop using `getJobStatus(jobId)` to track progress in real-time.
    4.  Once the job status changes to `completed`, the context triggers a refresh of the transaction logs.

---

## Investigator Workflows & Wireframe Flow

### 1. Typical Forensics Ingestion Loop
1.  **Statement Upload:** The investigator navigates to `/workspace` and drags scanned bank statements into the dropzone.
2.  **Visual Processing Queue:** The UI displays a card list showing processing status (OCR Parsing ➔ Schema Standardization ➔ Entity Resolution).
3.  **Risk Summary Load:** Once processing completes, high-risk scores trigger warnings on the overview panel.
4.  **Loop & Mule Detection:** The investigator shifts to `/workspace/round-trips` to view circular money-layering loops identified by the Neo4j depth-first-search engine.
5.  **FIFO Money Trail Tracing:** The investigator clicks on any suspicious credit transaction to open the `/workspace/money-trail` panel and trace the source of funds down to its debit distribution.
6.  **One-Click Report Generation:** Finally, the investigator goes to `/workspace/reports` and clicks "Generate Case File" to create a court-ready DOCX/PDF report.

### 2. Workspace Layout Wireframe
Below is the visual structure of the workspace layout shell:

```
+------------------------------------------------------------------------------------+
| FinIntel  [Case: #01-A9]               [Status: Connected]  [User: Willis]      |
+------------------------------------------------------------------------------------+
|  Navigation   |  Workspace Panel (Active analytical view container)                 |
|  -----------  |  --------------------------------------------------                 |
|               |  +--------------------------------------------------------------+   |
|  [ Dashboard ]|  | Ingestion Dropzone (drag scanned statements here)            |   |
|               |  | [ Drop files to ingest ]                                     |   |
|  [ Rd Trips ] |  +--------------------------------------------------------------+   |
|               |                                                                     |
|  [ Money Flw ]|  +---------------------------+  +-------------------------------+   |
|               |  | Active Statements         |  | Active System Health Pipeline |   |
|  [ FIFO Trls ]|  | - statement_sbi.pdf (OK)  |  | - Gateway: Online             |   |
|               |  | - statement_hdfc.csv (OK) |  | - OCR Parser: Idle            |   |
|  [ Reports ]  |  +---------------------------+  +-------------------------------+   |
|               |                                                                     |
|  [ Settings ] |  +--------------------------------------------------------------+   |
|               |  | Alert Center                                                 |   |
|               |  | - WARN: Accumulation point found on Account SBI-2038         |   |
|               |  +--------------------------------------------------------------+   |
+---------------+--------------------------------------------------------------------+
```



