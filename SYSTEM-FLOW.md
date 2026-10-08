# ShareSafely – System Flow

This document describes how the system fits together, from upload through to download and cleanup.

The diagrams use [Mermaid](https://mermaid.js.org/), which GitHub, Azure DevOps and VS Code (with a Mermaid extension) display as diagrams.

**Status key**

| Component | Status |
|---|---|
| Front end (`index.html`, `styles.css`, `app.js`) | Built |
| Back end, storage, Key Vault, SQL, cleanup job, monitoring | To be built (back end owner) |

> The back-end steps follow the [ShareSafely project brief](https://github.com/madebygps/cloud-engineering-projects/blob/main/az-104/sharesafely.md). The brief doesn't define endpoints, the database schema or exactly how the links are created. Where this document fills those gaps, the step is labelled *(assumed)*.

---

## 1. Architecture overview

```mermaid
flowchart LR
    subgraph Client["User's browser"]
        UI["ShareSafely front end<br/>index.html · styles.css · app.js"]
    end

    Recipient["Recipient<br/>(anyone with the link)"]

    subgraph Azure["Azure subscription"]
        subgraph App["Azure App Service (Web App)"]
            API["Back-end API<br/>POST /api/upload"]
            MI["Managed Identity"]
        end

        KV["Azure Key Vault<br/>storage account key"]
        BLOB[("Azure Blob Storage<br/>private container<br/>encrypted at rest")]
        SQL[("Azure SQL Database<br/>file metadata (assumed)")]
        FUNC["Azure Function / Logic App<br/>scheduled cleanup"]
        MON["Azure Monitor / App Insights<br/>Log Analytics"]
    end

    UI -- "1 · Upload file + expiry (HTTPS)" --> API
    API -- "2 · Get secret" --> MI
    MI -- "Entra ID auth" --> KV
    API -- "3 · Upload blob (SDK)" --> BLOB
    API -- "4 · Save metadata" --> SQL
    API -- "5 · Return SAS link" --> UI
    UI -. "6 · User shares link" .-> Recipient
    Recipient -- "7 · GET blob with SAS token" --> BLOB
    FUNC -- "Delete expired blobs" --> BLOB
    FUNC -- "Delete expired records" --> SQL
    API -. "telemetry" .-> MON
    BLOB -. "diagnostic logs" .-> MON
    FUNC -. "telemetry" .-> MON
```

---

## 2. Upload flow (end to end)

```mermaid
flowchart TD
    A([User opens ShareSafely]) --> B[Drag & drop or browse for a file]
    B --> C{File larger than<br/>maxFileSizeMB?}
    C -- Yes --> C1[Show size error in browser] --> B
    C -- No --> D[Show file name and size<br/>Enable Upload button]
    D --> E[User selects link expiry<br/>15 min · 1 h · 24 h · 7 days]
    E --> F[User clicks<br/>Upload &amp; generate link]
    F --> G{mockMode<br/>in app.js?}
    G -- true --> G1[Simulate upload in the browser<br/>Return demo link] --> R
    G -- false --> H["POST /api/upload<br/>multipart/form-data:<br/>file, expiryMinutes"]
    H --> H1[Progress bar updates<br/>as bytes are sent]

    H1 --> I["Back end: validate request<br/>size · type · expiry (assumed)"]
    I --> I1{Valid?}
    I1 -- No --> X["Return 4xx<br/>{ error: '...' }"]
    I1 -- Yes --> J[Get storage key from Key Vault<br/>via Managed Identity]
    J --> K["Generate unique blob name<br/>e.g. GUID/original-name (assumed)"]
    K --> L[Upload file to private<br/>Blob container via SDK]
    L --> L1{Upload OK?}
    L1 -- No --> X5["Return 5xx<br/>{ error: '...' }"]
    L1 -- Yes --> M["Create read-only SAS<br/>sp=r · expiry = now + expiryMinutes"]
    M --> N["Save metadata to Azure SQL<br/>blob name · expiry · size (assumed)"]
    N --> O["Return 200<br/>{ url, expiresOn }"]

    O --> R[Show success screen:<br/>link · Copy button · expiry countdown]
    X --> E1[Show error message on page]
    X5 --> E1
    E1 --> F
    R --> S{User action}
    S -- Copy --> S1[Copy link to clipboard<br/>Show 'Link copied']
    S -- Upload another --> B

    classDef fe fill:#e6f2fb,stroke:#0078d4,color:#1b1f24
    classDef be fill:#fff4ce,stroke:#c19c00,color:#1b1f24
    classDef err fill:#fde7e9,stroke:#c50f1f,color:#1b1f24
    class A,B,C,C1,D,E,F,G,G1,H,H1,R,S,S1,E1 fe
    class I,I1,J,K,L,L1,M,N,O be
    class X,X5 err
```

**Colour key:** blue = front end (built) · yellow = back end (to build) · red = error response

---

## 3. Upload sequence (who calls whom)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant FE as Front end (browser)
    participant API as App Service API
    participant KV as Key Vault
    participant B as Blob Storage
    participant DB as Azure SQL
    participant M as Azure Monitor

    U->>FE: Select file + expiry, click Upload
    FE->>FE: Check file size (maxFileSizeMB)
    FE->>API: POST /api/upload (file, expiryMinutes)
    Note over FE,API: Browser shows upload progress
    API->>KV: Get storage key (Managed Identity)
    KV-->>API: Secret
    API->>B: Upload blob (private container)
    B-->>API: 201 Created
    API->>API: Generate read-only SAS (expires now + N min)
    API->>DB: INSERT file record (assumed)
    API-)M: Log "file uploaded"
    API-->>FE: 200 { url, expiresOn }
    FE-->>U: Show link, Copy button, countdown
```

---

## 4. Download flow (recipient)

The recipient downloads the file **directly from Blob Storage**. The web app isn't involved, so the SAS token in the URL is the only thing that grants access.

```mermaid
flowchart TD
    A([Recipient opens shared link]) --> B["GET https://account.blob.core.windows.net/<br/>container/blob?sv=...&se=...&sp=r&sig=..."]
    B --> C{Storage checks SAS:<br/>signature valid?}
    C -- No --> X1[403 Authentication failed]
    C -- Yes --> D{Current time<br/>before expiry 'se'?}
    D -- No --> X2[403 Link expired]
    D -- Yes --> E{Blob still exists?}
    E -- No --> X3[404 Not found<br/>already cleaned up]
    E -- Yes --> F[File downloads to recipient]
    F --> G[Storage logs read request<br/>to Azure Monitor]
    X1 --> G
    X2 --> G

    classDef ok fill:#e7f4e7,stroke:#107c10,color:#1b1f24
    classDef err fill:#fde7e9,stroke:#c50f1f,color:#1b1f24
    class F ok
    class X1,X2,X3 err
```

---

## 5. Cleanup flow (scheduled)

```mermaid
flowchart TD
    T([Timer trigger<br/>e.g. every hour]) --> A[Azure Function / Logic App starts]
    A --> B["Query Azure SQL for records<br/>where expiry &lt; now (assumed)"]
    B --> C{Any expired files?}
    C -- No --> Z[Log 'nothing to clean'] --> END([End])
    C -- Yes --> D[For each expired record]
    D --> E[Delete blob from container]
    E --> F[Delete or flag record in SQL]
    F --> G{More records?}
    G -- Yes --> D
    G -- No --> H[Log count of deleted files<br/>to Azure Monitor] --> END
```

> **Optional:** a Blob Storage **lifecycle management** rule (for example, delete blobs older than 7 days) can act as a backstop in case the cleanup job fails.

---

## 6. Security and identity

```mermaid
flowchart LR
    subgraph Public["Public internet"]
        User["Uploader's browser"]
        Rec["Recipient"]
    end

    subgraph Azure
        App["App Service<br/>HTTPS only"]
        MI["System-assigned<br/>Managed Identity"]
        KV["Key Vault<br/>RBAC: Key Vault Secrets User"]
        ST[("Storage account<br/>public blob access: disabled<br/>container: private")]
    end

    User -- "TLS" --> App
    App --- MI
    MI -- "read secret" --> KV
    App -- "account key / SDK" --> ST
    Rec -- "TLS + SAS token (read-only, time-limited)" --> ST
```

| Control | Where | Purpose |
|---|---|---|
| HTTPS only | App Service | Encrypts uploads in transit |
| Managed Identity | App Service → Key Vault | No secrets in code or app settings |
| Key Vault | Stores the storage key | Central secret storage with rotation |
| Private container | Blob Storage | Blobs can't be read without a SAS |
| Read-only, time-limited SAS | Generated per upload | Link only allows downloads and stops working at expiry |
| Encryption at rest | Blob Storage (enabled by default) | Protects stored files |
| Size check | Front end and back end | The browser check helps users; the server check enforces the limit |
| Cleanup job | Function / Logic App | Removes files after their links expire |
| Monitoring | Azure Monitor / App Insights | Audit trail of uploads and downloads |

---

## 7. Front end ↔ back end contract

| | Detail |
|---|---|
| **Endpoint** | `POST /api/upload` (`CONFIG.uploadUrl` in `app.js`) |
| **Request** | `multipart/form-data`: `file` (binary), `expiryMinutes` (`15` · `60` · `1440` · `10080`) |
| **Success** | `2xx` + `{ "url": "<SAS URL>", "expiresOn": "<ISO 8601>" }` (`sasUrl`/`link` and `expiresAt` also accepted) |
| **Failure** | non-`2xx` + `{ "error": "<message shown to user>" }` |
| **Demo mode** | `CONFIG.mockMode = true` simulates the request in the browser. Set it to `false` for production. |
