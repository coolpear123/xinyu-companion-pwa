# 心语独立聊天后端

这是 `game.uben.com` 手机 PWA 的独立无状态聊天接口，不读取或写入“夜半不二”的代码、数据库或云环境。

## 本地运行

```powershell
npm install
npm run dev
```

未配置模型时，`POST /api/chat` 自动使用演示回复，方便完整验证前端、流式传输和动作协议。

## 接入真实模型

在部署平台的环境变量中配置：

- `OPENAI_API_KEY`：OpenAI API 项目密钥，仅保存在服务端。
- `OPENAI_MODEL`：OpenAI 模型 ID，当前默认 `gpt-6-luna`。
- `ALLOWED_ORIGINS`：允许调用接口的 PWA 地址，默认仅包含 `game.uben.com` 和本地预览地址。

不要把真实密钥写入 `.env.example`、前端文件、Git 提交、截图或聊天消息。

## 事件协议

接口返回 `text/event-stream`：

- `meta`：`demo` 或 `live` 模式。
- `reply`：回复文字增量。
- `replace`：必要时替换当前回复。
- `action`：最终的 `emotion / action / intensity`。
- `done`：一次回复完成。
- `error`：本次生成失败。
