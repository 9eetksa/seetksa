import { createHash } from "node:crypto";
import {
  CatalogError,
  createCatalogService,
} from "../server/catalog-service.mjs";

export const config = { maxDuration: 15 };
const allowedResources = new Set(["services", "portfolio"]);

function bearer(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string" || Buffer.byteLength(header) > 8200)
    return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header);
  return match?.[1] || null;
}

function resourceFrom(req) {
  const raw = String(req.url || "/");
  if (Buffer.byteLength(raw) > 1024)
    throw new CatalogError(414, "catalog_query", "طلب الكتالوج غير صالح");
  const url = new URL(raw, "http://catalog.local");
  const keys = [...url.searchParams.keys()];
  const values = url.searchParams.getAll("resource");
  if (
    keys.some((key) => key !== "resource") ||
    values.length !== 1 ||
    !allowedResources.has(values[0])
  )
    throw new CatalogError(400, "catalog_resource", "طلب الكتالوج غير صالح");
  return values[0];
}

function matchesEtag(header, etag) {
  return (
    typeof header === "string" &&
    Buffer.byteLength(header) <= 256 &&
    header
      .split(",")
      .map((value) => value.trim())
      .includes(etag)
  );
}

export function catalogHandler(
  env,
  { createService = createCatalogService } = {},
) {
  const publicConfiguration = Object.freeze({
    VITE_SUPABASE_URL: env?.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: env?.VITE_SUPABASE_PUBLISHABLE_KEY,
  });
  let service;
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Authorization");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "الطلب غير مدعوم" });
    }
    const token = bearer(req);
    if (!token) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return res.status(401).json({ error: "سجل الدخول للمتابعة" });
    }
    try {
      const resource = resourceFrom(req);
      service ||= createService(publicConfiguration);
      const result = await service({ resource, token });
      const body = JSON.stringify({ data: result.data });
      const etag = `"${createHash("sha256")
        .update(result.userId)
        .update("\0")
        .update(resource)
        .update("\0")
        .update(body)
        .digest("base64url")}"`;
      res.setHeader("Cache-Control", "private, max-age=5, must-revalidate");
      res.setHeader("ETag", etag);
      if (matchesEtag(req.headers["if-none-match"], etag))
        return res.status(304).end();
      return res.status(200).json({ data: result.data });
    } catch (error) {
      if (error instanceof CatalogError) {
        if (error.status === 401) res.setHeader("WWW-Authenticate", "Bearer");
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(500).json({ error: "تعذر تحميل الكتالوج" });
    }
  };
}

export default catalogHandler(process.env);
