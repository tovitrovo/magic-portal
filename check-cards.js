#!/usr/bin/env node

// Script para verificar e popular dados de teste no Supabase
// Execute com: node check-cards.js

const { createClient } = require('@supabase/supabase-js');

const SB_URL = 'https://kjyqnlpiohoewmqmsuxp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXFubHBpb2hvZXdtcW1zdXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNTA5NDAsImV4cCI6MjA4NzgyNjk0MH0.1BjTAFgv7yfJ00uY6WNlwUOYd4c4YOqFTV78CLvLBk0';

const supabase = createClient(SB_URL, SB_KEY);

async function checkCards() {
  console.log('🔍 Verificando cartas no banco de dados...');

  try {
    const { data, error } = await supabase
      .from('cards')
      .select('id, name, type, is_active')
      .limit(5);

    if (error) {
      console.error('❌ Erro ao buscar cartas:', error.message);
      return;
    }

    console.log(`✅ Encontradas ${data.length} cartas:`);
    data.forEach(card => {
      console.log(`  - ${card.name} (${card.type})`);
    });

    if (data.length === 0) {
      console.log('📝 Nenhuma carta encontrada. Criando dados de exemplo...');
      await createSampleCards();
    } else {
      console.log('🎉 Banco já tem cartas! O catálogo deve funcionar.');
    }
  } catch (e) {
    console.error('❌ Erro:', e.message);
  }
}

async function createSampleCards() {
  const sampleCards = [
    { name: 'Lightning Bolt', type: 'Normal', is_active: true },
    { name: 'Black Lotus', type: 'Normal', is_active: true },
    { name: 'Mox Sapphire', type: 'Normal', is_active: true },
    { name: 'Ancestral Recall', type: 'Normal', is_active: true },
    { name: 'Brainstorm', type: 'Normal', is_active: true },
    { name: 'Counterspell', type: 'Normal', is_active: true },
    { name: 'Dark Ritual', type: 'Normal', is_active: true },
    { name: 'Lightning Helix', type: 'Normal', is_active: true },
    { name: 'Path to Exile', type: 'Normal', is_active: true },
    { name: 'Swords to Plowshares', type: 'Normal', is_active: true },
    { name: 'Lightning Bolt', type: 'Foil', is_active: true },
    { name: 'Black Lotus', type: 'Foil', is_active: true },
    { name: 'Mox Sapphire', type: 'Foil', is_active: true },
    { name: 'Ancestral Recall', type: 'Foil', is_active: true },
    { name: 'Brainstorm', type: 'Foil', is_active: true },
    { name: 'Counterspell', type: 'Foil', is_active: true },
    { name: 'Dark Ritual', type: 'Foil', is_active: true },
    { name: 'Lightning Helix', type: 'Foil', is_active: true },
    { name: 'Path to Exile', type: 'Foil', is_active: true },
    { name: 'Swords to Plowshares', type: 'Foil', is_active: true },
    { name: 'Lightning Bolt', type: 'Holo', is_active: true },
    { name: 'Black Lotus', type: 'Holo', is_active: true },
    { name: 'Mox Sapphire', type: 'Holo', is_active: true },
    { name: 'Ancestral Recall', type: 'Holo', is_active: true },
    { name: 'Brainstorm', type: 'Holo', is_active: true },
    { name: 'Counterspell', type: 'Holo', is_active: true },
    { name: 'Dark Ritual', type: 'Holo', is_active: true },
    { name: 'Lightning Helix', type: 'Holo', is_active: true },
    { name: 'Path to Exile', type: 'Holo', is_active: true },
    { name: 'Swords to Plowshares', type: 'Holo', is_active: true }
  ];

  try {
    const { data, error } = await supabase
      .from('cards')
      .insert(sampleCards)
      .select();

    if (error) {
      console.error('❌ Erro ao criar cartas:', error.message);
    } else {
      console.log(`✅ ${data.length} cartas criadas com sucesso!`);
      console.log('🎉 Agora o catálogo deve funcionar.');
    }
  } catch (e) {
    console.error('❌ Erro:', e.message);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  checkCards();
}

module.exports = { checkCards, createSampleCards };</content>
<parameter name="filePath">c:\Users\afons\Desktop\CPJ\magic-portal\check-cards.js