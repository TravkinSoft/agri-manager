import { createServer } from "node:http";

const port = Number(process.env.A106_MOCK_PORT || 3107);

function responseText(body) {
  const input = JSON.stringify(body?.input || body?.messages || []).toLowerCase();
  if (/(создай|измени|удали|спиши|проведи).{0,80}(операц|склад|материал|erp)/i.test(input)) {
    return "Это действие недоступно: локальный A106 ассистент работает только на чтение. Данные ERP не изменены.";
  }
  return "Локальный A106 mock отвечает без внешнего OpenAI-вызова. Проверьте историю, новый чат и личную память во вкладке Settings.";
}

const server = createServer((request, response) => {
  if (request.method !== "POST" || (request.url !== "/v1/responses" && request.url !== "/v1/chat/completions")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
    return;
  }
  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch {}
    const text = responseText(body);
    response.writeHead(200, { "content-type": "application/json", "x-request-id": "a106-local-mock" });
    if (request.url === "/v1/chat/completions") {
      response.end(JSON.stringify({
        id: "chatcmpl_a106_local",
        model: "a106-local-mock",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }));
      return;
    }
    response.end(JSON.stringify({
      id: "resp_a106_local",
      model: "a106-local-mock",
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 } },
    }));
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`A106 local OpenAI mock listening on http://127.0.0.1:${port}\n`);
});
