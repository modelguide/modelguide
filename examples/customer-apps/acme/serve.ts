const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;

    const file = Bun.file(`./dist${path}`);
    if (await file.exists()) return new Response(file);

    // SPA fallback
    return new Response(Bun.file("./dist/index.html"));
  },
});

console.log(`Serving on http://localhost:${server.port}`);
