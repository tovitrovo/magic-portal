const { createClient } = require('@supabase/supabase-js');

const SB_URL = 'https://kjyqnlpiohoewmqmsuxp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXFubHBpb2hvZXdtcW1zdXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNTA5NDAsImV4cCI6MjA4NzgyNjk0MH0.1BjTAFgv7yfJ00uY6WNlwUOYd4c4YOqFTV78CLvLBk0';

const supabase = createClient(SB_URL, SB_KEY);

async function debugOrders() {
  try {
    console.log('🔍 Verificando pedidos no banco de dados...\n');

    // Buscar campanha ativa
    const { data: campaigns, error: campError } = await supabase
      .from('campaigns')
      .select('id, name, status')
      .eq('status', 'ACTIVE')
      .limit(1);

    if (campError) {
      console.error('Erro ao buscar campanhas:', campError);
      return;
    }

    const activeCampaign = campaigns[0];
    console.log('📊 Campanha ativa:', activeCampaign);

    if (!activeCampaign) {
      console.log('❌ Nenhuma campanha ativa encontrada!');
      return;
    }

    // Buscar todos os pedidos da campanha ativa
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        created_at,
        user_id,
        qty_paid,
        qty_bonus,
        status,
        campaign_id,
        profiles(name, whatsapp),
        order_batches(
          id,
          status,
          total_locked,
          qty_in_batch,
          mp_payment_id,
          payment_status,
          confirmed_at
        )
      `)
      .eq('campaign_id', activeCampaign.id)
      .order('created_at', { ascending: false });

    if (ordersError) {
      console.error('Erro ao buscar pedidos:', ordersError);
      return;
    }

    console.log(`\n📋 Total de pedidos encontrados: ${orders.length}\n`);

    // Analisar pedidos
    const paidOrders = [];
    const pendingOrders = [];
    const allBatches = [];

    orders.forEach(order => {
      const batches = order.order_batches || [];
      allBatches.push(...batches);

      const hasPaidBatch = batches.some(b => b.status === 'PAID' || b.status === 'CONFIRMED');
      const hasPendingBatch = batches.some(b => b.status === 'DRAFT' || b.status === 'PENDING_PAYMENT');

      if (hasPaidBatch) {
        paidOrders.push(order);
      } else if (hasPendingBatch) {
        pendingOrders.push(order);
      }

      console.log(`Pedido #${order.id}:`);
      console.log(`  Cliente: ${order.profiles?.name || 'N/A'}`);
      console.log(`  Status: ${order.status}`);
      console.log(`  Batches: ${batches.length}`);
      batches.forEach(batch => {
        console.log(`    - Batch #${batch.id.slice(-8)}: ${batch.status} (${batch.qty_in_batch} cartas)`);
      });
      console.log('');
    });

    // Estatísticas
    console.log('📊 Estatísticas:');
    console.log(`  Total pedidos: ${orders.length}`);
    console.log(`  Pedidos pagos: ${paidOrders.length}`);
    console.log(`  Pedidos pendentes: ${pendingOrders.length}`);
    console.log(`  Total batches: ${allBatches.length}`);

    // Status únicos dos batches
    const uniqueStatuses = [...new Set(allBatches.map(b => b.status))];
    console.log(`  Status dos batches: ${uniqueStatuses.join(', ')}`);

    // Verificar se há pedidos pagos que deveriam aparecer
    if (paidOrders.length === 0) {
      console.log('\n⚠️  Nenhum pedido pago encontrado!');
      console.log('Isso pode significar:');
      console.log('1. Nenhum pedido foi realmente marcado como pago');
      console.log('2. Os pedidos estão em uma campanha diferente');
      console.log('3. Há um problema com os status dos batches');
    } else {
      console.log(`\n✅ Encontrados ${paidOrders.length} pedidos pagos que deveriam aparecer no painel admin.`);
    }

  } catch (error) {
    console.error('Erro geral:', error);
  }
}

debugOrders();