import "@/styles/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Magic Portal",
  description: "Portal de encomenda de cartas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="container">
          <div className="row" style={{alignItems:"center", justifyContent:"space-between", marginBottom:14}}>
            <a href="/" className="tag">🧙 Magic Portal</a>
            <div className="row">
              <a className="tag" href="/wants">Wants</a>
              <a className="tag" href="/checkout">Checkout</a>
              <a className="tag" href="/auth">Login</a>
            </div>
          </div>
          {children}
          <div className="small" style={{marginTop:18, opacity:.8}}>
            Versão local (sem banco). Pagamento + frete via Functions.
          </div>
        </div>
      </body>
    </html>
  );
}
