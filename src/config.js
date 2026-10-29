// Configuração pública do cliente: projeto Supabase (chave anon) e helpers
// de API usados tanto pela loja quanto pelo console admin.

export const SB_URL = 'https://kjyqnlpiohoewmqmsuxp.supabase.co';
export const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXFubHBpb2hvZXdtcW1zdXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNTA5NDAsImV4cCI6MjA4NzgyNjk0MH0.1BjTAFgv7yfJ00uY6WNlwUOYd4c4YOqFTV78CLvLBk0';

// Sync Mercado Pago status for a batch (server-side)
export async function mpSync(batchId){
  const r = await fetch('/api/mp-sync', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ batchId: String(batchId) })
  });
  const txt = await r.text();
  let j = {};
  try{ j = JSON.parse(txt); } catch { j = { raw: txt }; }
  if(!r.ok || !j.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
  return j;
}
