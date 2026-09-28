import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança em todas as respostas (auditoria de 28/09/2026).
 * A CSP aqui só trava o que não quebra o app: ninguém embute o Kontrol em
 * outro site (frame-ancestors), nada de <object>/<embed>, <base> e envio de
 * formulário só para o próprio app. A câmera fica liberada só para o próprio
 * site, por causa do scanner.
 */
const CABECALHOS_SEGURANCA = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs"],
  async headers() {
    return [{ source: "/:path*", headers: CABECALHOS_SEGURANCA }];
  },
  async redirects() {
    return [
      {
        source: "/orcamentos",
        destination: "/orcamento",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
