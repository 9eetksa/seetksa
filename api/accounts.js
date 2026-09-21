import { createAccountService } from "../server/account-service.mjs";
export const config = { maxDuration: 60 };
export function accountHandler(env) {
  let service;
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "الطلب غير مدعوم" });
    }
    try {
      if (
        !String(req.headers["content-type"] || "").includes("application/json")
      )
        return res.status(415).json({ error: "تنسيق الطلب غير صالح" });
      let body, raw;
      try {
        const supplied = req.body;
        raw = typeof supplied === 'string' ? supplied : JSON.stringify(supplied || {});
        body = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: "بيانات الطلب غير صالحة" });
      }
      if (Buffer.byteLength(raw) > 12000)
        return res.status(413).json({ error: "الطلب أكبر من المسموح" });
      if (!body || Array.isArray(body) || typeof body !== "object")
        return res.status(400).json({ error: "بيانات الطلب غير صالحة" });
      service ||= createAccountService(env);
      const ip = env.VERCEL
        ? String(req.headers["x-forwarded-for"] || "unknown").split(",")[0]
        : req.socket?.remoteAddress || "local";
      const result = await service(
        body,
        String(req.headers.authorization || "").replace(/^Bearer /i, ""),
        ip,
      );
      return res.status(200).json(result);
    } catch (e) {
      if(e instanceof SyntaxError) return res.status(400).json({error:'بيانات الطلب غير صالحة'});
      return res.status(e.status || 500).json({
        error: e.status ? e.message : "تعذر إكمال العملية حاول مجددا",
      });
    }
  };
}
export default accountHandler(process.env);
