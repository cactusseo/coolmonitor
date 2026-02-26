# Thesis Formatter

A specialized tool to help students format their theses according to strict academic guidelines using Semantic Mapping and LLMs.

## Project Structure

- `backend/`: FastAPI application handling document processing, logic, and LLM interaction.
- `frontend/`: Next.js application for user interaction (upload, preview, download).
- `DESIGN.md`: Detailed technical design document.

## Architecture

1.  **Semantic Mapping**: Instead of asking an LLM to "rewrite" the document, we use it to classify text blocks (Heading, Body, Caption, etc.).
2.  **Deterministic Formatting**: A Python engine (`python-docx`) rebuilds the document applying precise styles based on the semantic map.

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- Docker (optional, for Redis/Postgres)

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

## Roadmap

- [ ] **Phase 1 (MVP)**:
    - [x] Project Scaffolding
    - [ ] Core Formatting Engine (Python-docx wrapper)
    - [ ] Semantic Mapper (LLM Integration)
    - [ ] Basic Web UI (Upload -> Process -> Download)
- [ ] **Phase 2**:
    - [ ] School Database
    - [ ] User Accounts
- [ ] **Phase 3**:
    - [ ] LaTeX Support
    - [ ] Citations

## License

MIT
