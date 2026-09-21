import { defineConfig, loadEnv } from "vite";
import { accountHandler } from "./api/accounts.js";
import { catalogHandler } from "./api/catalog.js";
import { portfolioHandler } from './api/portfolio.js';
import { impersonationHandler } from './api/impersonation.js';
export default defineConfig(({ mode }) => ({
  // Keep IDE previews on a predictable IPv4 loopback address and port
  server: { host: "127.0.0.1", port: 5175, strictPort: true },
  plugins: [
    {
      name: "provision-account-api",
      configureServer(server) {
        const handler = accountHandler(loadEnv(mode, process.cwd(), ""));
        const catalog = catalogHandler(loadEnv(mode, process.cwd(), ""));
        const portfolio = portfolioHandler(loadEnv(mode, process.cwd(), ''));
        server.middlewares.use('/api/portfolio', async (req, res) => {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 2048) { res.statusCode = 413; res.end(); return; }
          }
          req.body = body;
          res.status = code => { res.statusCode = code; return res; };
          res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
          await portfolio(req, res);
        });
        const impersonation = impersonationHandler(loadEnv(mode, process.cwd(), ''));
        server.middlewares.use('/api/impersonation', async (req,res)=>{
          let body='';
          for await (const chunk of req) {
            body+=chunk;
            if(Buffer.byteLength(body)>2*1024*1024){res.statusCode=413;res.end();return;}
          }
          req.body=body;
          res.status=code=>{res.statusCode=code;return res;};
          res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
          await impersonation(req,res);
        });
        server.middlewares.use("/api/catalog", async (req, res) => {
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (value) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(value));
          };
          await catalog(req, res);
        });
        server.middlewares.use("/api/accounts", async (req, res) => {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 12000) {
              res.statusCode = 413;
              res.end();
              return;
            }
          }
          req.body = body;
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (value) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(value));
          };
          await handler(req, res);
        });
      },
    },
  ],
}));
