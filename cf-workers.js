const ALLOWED_ORIGIN = "https://wait.3y.f5.si"; // ドメイン

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const isAllowed = origin === ALLOWED_ORIGIN;

    // 許可されていないオリジンは、プリフライトも含めて弾く
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: "Forbidden: origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    try {
      const body = await request.json();
      const promptText = body.prompt;

      if (!promptText) {
        throw new Error("Prompt is missing");
      }

      // Workers AI 実行
      const aiResponse = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
        messages: [
          {
            role: "system",
            content: "You must output a valid JSON object only, containing 'themeName' (string) and 'colors' (object with bgMain, bgSurface, bgPanel, textMain, textSub, accentBlue, accentHover, toggleBg, borderSoft). Do not include any extra text."
          },
          { role: "user", content: promptText }
        ]
      });

      // 正しいパス（choices[0].message.content）からテキストを取得
      let contentString = "";
      if (aiResponse && aiResponse.choices && aiResponse.choices[0] && aiResponse.choices[0].message) {
        contentString = aiResponse.choices[0].message.content || "";
      } else if (typeof aiResponse === "string") {
        contentString = aiResponse;
      } else {
        contentString = JSON.stringify(aiResponse);
      }

      // マークダウン（```json ... ```）を綺麗に取り除く
      let cleanJsonText = contentString
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      // 文字列の中から最初の '{' から最後の '}' までを抽出
      const firstBrace = cleanJsonText.indexOf('{');
      const lastBrace = cleanJsonText.lastIndexOf('}');

      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error("No JSON structure found in model content: " + cleanJsonText);
      }

      const jsonString = cleanJsonText.substring(firstBrace, lastBrace + 1);

      // JSONとしてパース
      const parsedData = JSON.parse(jsonString);

      // 両端（bgMain）の色を基準にして、背景に関連するすべてのキー（bgSurface, bgPanel, toggleBg 等）を強制的に同一の色に統一する
      if (parsedData.colors && parsedData.colors.bgMain) {
        const baseBg = parsedData.colors.bgMain;
        parsedData.colors.bgSurface = baseBg;
        parsedData.colors.bgPanel = baseBg;
        parsedData.colors.toggleBg = baseBg;
      }

      // 調整済みのデータを返却
      return new Response(JSON.stringify(parsedData), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders(origin),
        },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
      });
    }
  },
};
