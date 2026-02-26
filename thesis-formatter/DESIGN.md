# 论文格式化工具 (Thesis Formatter)：技术设计文档

## 1. 简介 (Introduction)

本文档概述了 **Thesis Formatter**（论文格式化工具）的技术架构与实施策略。该工具旨在帮助大学生根据严格的学术规范，自动化调整其论文格式。

核心价值在于自动化处理繁琐且易错的学术文档排版工作（Word/docx），通过结合**确定性规则引擎 (python-docx)** 与 **LLM 语义理解能力** 来实现高精度格式化。

## 2. 架构概览 (Architecture Overview)

系统采用现代化的微服务架构，分离前端、后端 API 以及长耗时的处理任务。

### 高层架构图

```mermaid
graph TD
    User[用户 (浏览器)] -->|上传/下载| FE[前端 (Next.js)]
    FE -->|REST API| API[后端 API (FastAPI)]
    API -->|入队任务| Redis[(Redis 队列)]
    Redis -->|处理任务| Worker[Celery Worker (Python)]
    Worker -->|读/写| Storage[(文件存储 / S3)]
    Worker -->|分析/格式化| Engine[核心格式化引擎]
    Engine -->|语义理解| LLM[LLM 服务 (OpenAI/Claude)]
    API -->|查询元数据| DB[(PostgreSQL)]
```

## 3. 核心组件 (Core Components)

### 3.1 前端 (Next.js + Tailwind CSS)
- **框架**: Next.js (App Router) 用于服务端渲染和静态生成。
- **样式**: Tailwind CSS 用于快速 UI 开发。
- **状态管理**: React Query (TanStack Query) 用于服务端状态同步；Zustand/Context 用于本地状态。
- **关键功能**:
    - 文件上传（拖拽式）带进度条。
    - 实时状态更新（轮询或 WebSocket）。
    - 文档预览（PDF.js 或类似方案）。
    - 用户仪表盘（历史记录、模板选择）。

### 3.2 后端 API (FastAPI)
- **框架**: FastAPI，提供高性能异步 API。
- **数据库 ORM**: SQLAlchemy (Async) 或 Tortoise-ORM。
- **认证**: JWT (JSON Web Tokens)。
- **职责**:
    - 处理文件上传/下载。
    - 管理用户会话。
    - 分发格式化任务到 Celery。
    - 提供格式化规则/模板。

### 3.3 任务队列 (Celery + Redis)
- **Broker**: Redis。
- **Backend**: Redis (用于存储任务结果)。
- **角色**: 将文档处理的繁重计算从请求/响应循环中解耦。
- **任务**:
    - `parse_document`: 提取文本与结构。
    - `analyze_semantics`: 使用 LLM 对内容进行分类（如：这是一级标题、正文还是图片标题？）。
    - `apply_formatting`: 使用 python-docx 应用样式。
    - `generate_preview`: 将 DOCX 转换为 PDF 用于预览。

### 3.4 格式化引擎 (Python Core)
系统的核心部分。
- **库**: `python-docx` 用于文档操作。
- **策略**: 语义映射 (Semantic Mapping，详见第 4 节)。
- **LLM 集成**: 仅用于**理解**文档结构，**绝不用于生成**最终文档内容。

## 4. 数据流：语义映射策略 (The Semantic Mapping Approach)

为了确保准确性并防止 LLM“幻觉”（胡乱修改内容），我们采取以下策略：**LLM 只负责标注结构，代码负责重绘格式**。

1.  **摄入 (Ingestion)**:
    - 用户上传 `draft.docx`。
    - 系统使用 `python-docx` 读取文件。
    - 提取原始文本块及其基本属性（字号、加粗、缩进）。

2.  **结构分析 (The "Mapper")**:
    - **启发式阶段**: 识别明显的元素（例如：“摘要”、“参考文献”、标准段落）。
    - **LLM 阶段**: 将模糊不清的文本块发送给 LLM 进行分类。
        - *Prompt*: "给定这段文本块：'图 3.2：系统架构图'，请将其分类为 [Heading, Body, Caption, Code]。"
        - *Output*: `{"id": "block_123", "type": "figure_caption", "confidence": 0.98}`。

3.  **中间表示 (Intermediate Representation, IR)**:
    - 文档被转化为一个 JSON 结构，代表其**语义内容**，独立于具体格式。
    ```json
    {
      "sections": [
        { "type": "heading_1", "text": "引言", "id": "h1_1" },
        { "type": "body_text", "text": "本论文探讨了...", "id": "p_1" },
        { "type": "citation", "source": "张三等 (2020)", "id": "c_1" }
      ]
    }
    ```

4.  **格式执行 (Formatting Execution)**:
    - 引擎读取 IR 并应用特定的**样式模板**（例如：“某大学硕士论文模板”）。
    - 使用 `python-docx` 从头生成一个新的 `formatted.docx`，逐个元素写入并应用正确样式。
    - **关键点**: 原始内容被完整保留，仅样式被强制应用。

## 5. 数据库设计 (初步)

### Users (用户)
- `id`: UUID
- `email`: String
- `password_hash`: String
- `created_at`: DateTime

### Documents (文档)
- `id`: UUID
- `user_id`: UUID (FK)
- `original_filename`: String
- `storage_path`: String
- `status`: Enum (UPLOADED, PROCESSING, COMPLETED, FAILED)
- `processed_path`: String (Nullable)
- `created_at`: DateTime

### Templates (学校规则模板)
- `id`: UUID
- `school_name`: String
- `rules_json`: JSON (存储页边距、字体、间距规则)
- `is_public`: Boolean

## 6. API 设计 (MVP)

- `POST /api/v1/upload`: 上传 DOCX 文件。返回 `task_id`。
- `GET /api/v1/tasks/{task_id}`: 查询处理状态。
- `GET /api/v1/documents/{document_id}/download`: 下载格式化后的文件。
- `GET /api/v1/templates`: 列出可用的格式模板。

## 7. 技术栈总结

| 组件 | 技术选型 |
| :--- | :--- |
| **语言** | Python 3.10+ |
| **后端框架** | FastAPI |
| **前端框架** | Next.js 14+ |
| **任务队列** | Celery |
| **消息代理** | Redis |
| **数据库** | PostgreSQL |
| **DOCX 处理** | python-docx |
| **LLM 接口** | OpenAI API / Anthropic API (通过 LangChain 或直接调用) |
| **容器化** | Docker & Docker Compose |
