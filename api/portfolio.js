import { createPortfolioService } from '../server/portfolio-service.mjs';
export const config = { maxDuration: 30 };
export function portfolioHandler(env, dependencies) {
  const service = createPortfolioService(env, dependencies);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method === 'GET') return res.status(200).json({ data: await service.list() });
      if (req.method !== 'DELETE') {
        res.setHeader('Allow', 'GET, DELETE');
        return res.status(405).json({ error: 'الطلب غير مدعوم' });
      }
      if (!String(req.headers['content-type'] || '').includes('application/json'))
        return res.status(415).json({ error: 'تنسيق الطلب غير صالح' });
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      if (Buffer.byteLength(raw) > 2048) return res.status(413).json({ error: 'الطلب أكبر من المسموح' });
      const input = JSON.parse(raw);
      const token = String(req.headers.authorization || '').replace(/^Bearer /i, '');
      return res.status(200).json(await service.remove(input, token));
    } catch (error) {
      return res.status(error instanceof SyntaxError ? 400 : error.status || 500).json({
        error: error.status ? error.message : 'تعذر إكمال العملية حاول مجددا',
      });
    }
  };
}
export default portfolioHandler(process.env);
