# Thesis Formatter: Technical Design Document

## 1. Introduction

This document outlines the technical architecture and implementation strategy for the **Thesis Formatter**, a tool designed to help university students automatically format their theses according to strict academic guidelines.

The core value proposition is to automate the tedious and error-prone process of formatting academic documents (Word/docx), leveraging a combination of deterministic rules (python-docx) and LLM-based semantic understanding.

## 2. Architecture Overview

The system follows a modern microservices-inspired architecture, separating the frontend, backend API, and long-running processing tasks.

### High-Level Diagram

```mermaid
graph TD
    User[User (Browser)] -->|Upload/Download| FE[Frontend (Next.js)]
    FE -->|REST API| API[Backend API (FastAPI)]
    API -->|Enqueue Task| Redis[(Redis Queue)]
    Redis -->|Process Task| Worker[Celery Worker (Python)]
    Worker -->|Read/Write| Storage[(File Storage / S3)]
    Worker -->|Analyze/Format| Engine[Formatting Engine]
    Engine -->|Semantic Understanding| LLM[LLM Service (OpenAI/Claude)]
    API -->|Query Metadata| DB[(PostgreSQL)]
```

## 3. Core Components

### 3.1 Frontend (Next.js + Tailwind CSS)
- **Framework**: Next.js (App Router) for server-side rendering and static generation.
- **Styling**: Tailwind CSS for rapid UI development.
- **State Management**: React Query (TanStack Query) for server state; Zustand/Context for local state.
- **Key Features**:
    - File Upload (Drag & Drop) with progress bar.
    - Real-time status updates (via polling or WebSocket).
    - Document Preview (PDF.js or similar).
    - User Dashboard (History, Templates).

### 3.2 Backend API (FastAPI)
- **Framework**: FastAPI for high-performance async API.
- **Database ORM**: SQLAlchemy (Async) or Tortoise-ORM.
- **Authentication**: JWT (JSON Web Tokens).
- **Responsibilities**:
    - Handle file uploads/downloads.
    - Manage user sessions.
    - Dispatch formatting tasks to Celery.
    - Serve formatting rules/templates.

### 3.3 Task Queue (Celery + Redis)
- **Broker**: Redis.
- **Backend**: Redis (for task results).
- **Role**: Decouples the heavy lifting of document processing from the request/response cycle.
- **Tasks**:
    - `parse_document`: Extract text and structure.
    - `analyze_semantics`: Use LLM to classify content (Heading 1 vs Body vs Caption).
    - `apply_formatting`: Apply styles using python-docx.
    - `generate_preview`: Convert DOCX to PDF for preview.

### 3.4 Formatting Engine (Python Core)
The heart of the system.
- **Library**: `python-docx` for manipulation.
- **Strategy**: Semantic Mapping (See Section 4).
- **LLM Integration**: Used for *understanding* structure, not generating content.

## 4. Data Flow: The Semantic Mapping Approach

To ensure accuracy and prevent hallucinations, we do not let the LLM rewrite the document. instead, we use it to *annotate* the document structure.

1.  **Ingestion**:
    - User uploads `draft.docx`.
    - System reads the file using `python-docx`.
    - Extracts raw text blocks with their basic properties (font size, bold, indentation).

2.  **Structural Analysis (The "Mapper")**:
    - **Heuristic Phase**: Classify obvious elements (e.g., "Abstract", "References", standard paragraphs).
    - **LLM Phase**: Send ambiguous blocks to LLM.
        - *Prompt*: "Given this text block: 'Figure 3.2: System Architecture', classify it as [Heading, Body, Caption, Code]."
        - *Output*: `{"id": "block_123", "type": "figure_caption", "confidence": 0.98}`.

3.  **Intermediate Representation (IR)**:
    - The document is converted to a JSON structure representing the *semantic* content, independent of formatting.
    ```json
    {
      "sections": [
        { "type": "heading_1", "text": "Introduction", "id": "h1_1" },
        { "type": "body_text", "text": "This thesis explores...", "id": "p_1" },
        { "type": "citation", "source": "Smith et al. (2020)", "id": "c_1" }
      ]
    }
    ```

4.  **Formatting Execution**:
    - The engine takes the IR and applies a specific **Style Template** (e.g., "University X Thesis Template").
    - It generates a *new* `formatted.docx` using `python-docx`, writing elements one by one with the correct styles.
    - **Crucial**: Content is preserved; only style is applied.

## 5. Database Schema (Preliminary)

### Users
- `id`: UUID
- `email`: String
- `password_hash`: String
- `created_at`: DateTime

### Documents
- `id`: UUID
- `user_id`: UUID (FK)
- `original_filename`: String
- `storage_path`: String
- `status`: Enum (UPLOADED, PROCESSING, COMPLETED, FAILED)
- `processed_path`: String (Nullable)
- `created_at`: DateTime

### Templates (School Rules)
- `id`: UUID
- `school_name`: String
- `rules_json`: JSON (Stores margins, fonts, spacing rules)
- `is_public`: Boolean

## 6. API Design (MVP)

- `POST /api/v1/upload`: Upload a DOCX file. Returns `task_id`.
- `GET /api/v1/tasks/{task_id}`: Check processing status.
- `GET /api/v1/documents/{document_id}/download`: Download the formatted file.
- `GET /api/v1/templates`: List available formatting templates.

## 7. Technology Stack Summary

| Component | Technology |
| :--- | :--- |
| **Language** | Python 3.10+ |
| **Backend Framework** | FastAPI |
| **Frontend Framework** | Next.js 14+ |
| **Task Queue** | Celery |
| **Message Broker** | Redis |
| **Database** | PostgreSQL |
| **DOCX Handling** | python-docx |
| **LLM Interface** | OpenAI API / Anthropic API (via LangChain or direct) |
| **Containerization** | Docker & Docker Compose |
