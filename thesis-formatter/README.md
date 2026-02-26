# Thesis Formatter (论文格式化工具)

这是一个专注于帮助大学生按照严格的学术规范自动调整论文格式的工具，采用语义映射（Semantic Mapping）和 LLM 技术。

## 项目结构

- `backend/`: FastAPI 后端应用，负责文档处理逻辑、LLM 交互等。
- `frontend/`: Next.js 前端应用，提供文件上传、预览、下载等用户界面。
- `DESIGN.md`: 详细的技术设计文档（中文版）。

## 架构核心

1.  **语义映射 (Semantic Mapping)**: 我们**不**让 LLM 直接“重写”文档，而是利用 LLM 识别文本块的语义类别（如：一级标题、正文、图片标题等）。
2.  **确定性格式化 (Deterministic Formatting)**: 使用 Python 引擎 (`python-docx`) 根据语义图谱，严格按照规则模板重建文档，确保格式精准无误。

## 快速开始

### 前置条件

- Python 3.10+
- Node.js 18+
- Docker (可选，用于 Redis/Postgres)

### 后端设置

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows 用户: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### 前端设置

```bash
cd frontend
npm install
npm run dev
```

## 路线图 (Roadmap)

- [ ] **第一阶段 (MVP)**:
    - [x] 项目脚手架搭建
    - [ ] 核心格式化引擎 (Python-docx 封装)
    - [ ] 语义映射器 (LLM 集成)
    - [ ] 基础 Web 界面 (上传 -> 处理 -> 下载)
- [ ] **第二阶段**:
    - [ ] 学校格式数据库
    - [ ] 用户账户系统
- [ ] **第三阶段**:
    - [ ] LaTeX 支持
    - [ ] 参考文献自动转换

## 许可证

MIT
