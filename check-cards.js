#!/usr/bin/env node

// Script para verificar e popular dados de teste no Supabase
// Execute com: node check-cards.js
// Use --seed para criar cartas de exemplo quando o catálogo estiver vazio.

import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env.SB_URL || 'https://kjyqnlpiohoewmqmsuxp.supabase.co';
const SB_KEY = process.env.SB_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXFubHBpb2hvZXdtcW1zdXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNTA5NDAsImV4cCI6MjA4NzgyNjk0MH0.1BjTAFgv7yfJ00uY6WNlwUOYd4c4YOqFTV78CLvLBk0';
const SHOULD_SEED = process.argv.includes('--seed');

const supabase = createClient(SB_URL, SB_KEY);

function groupByTcgAndType(cards) {
  return cards.reduce((acc, card) => {
    const key = `${card.tcg || '(sem tcg)'} / ${card.type || '(sem tipo)'}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

async function checkCards() {
  console.log('🔍 Verificando cartas no banco de dados...');

  try {
    const { data, error } = await supabase
      .from('cards')
      .select('id, name, type, tcg, image_url, is_active, created_at')
      .order('name', { ascending: true })
      .limit(1000);

    if (error) {
      console.error('❌ Erro ao buscar cartas:', error.message);
      return;
    }

    const cards = data || [];
    const activeCards = cards.filter(card => card.is_active);
    const inactiveCards = cards.filter(card => !card.is_active);
    const missingImages = cards.filter(card => !card.image_url);

    console.log(`✅ Encontradas ${cards.length} cartas (${activeCards.length} ativas, ${inactiveCards.length} inativas).`);
    console.log('📊 Distribuição por TCG/tipo:', groupByTcgAndType(cards));
    console.log(`🖼️  Cartas sem imagem: ${missingImages.length}`);

    cards.slice(0, 10).forEach(card => {
      const status = card.is_active ? 'ativa' : 'inativa';
      console.log(`  - ${card.name} | ${card.tcg} | ${card.type} | ${status}`);
    });

    if (cards.length === 0) {
      if (SHOULD_SEED) {
        console.log('📝 Nenhuma carta encontrada. Criando dados de exemplo...');
        await createSampleCards();
      } else {
        console.log('📝 Nenhuma carta encontrada. Rode `node check-cards.js --seed` se quiser criar dados de exemplo.');
      }
    } else {
      console.log('🎉 Banco já tem cartas! O catálogo deve funcionar.');
    }
  } catch (e) {
    console.error('❌ Erro:', e.message);
  }
}

async function createSampleCards() {
  const sampleCards = [
    { name: 'Lightning Bolt', type: 'Normal', tcg: 'Magic', is_active: true },
    { name: 'Black Lotus', type: 'Normal', tcg: 'Magic', is_active: true },
    { name: 'Mox Sapphire', type: 'Normal', tcg: 'Magic', is_active: true },
    { name: 'Ancestral Recall', type: 'Normal', tcg: 'Magic', is_active: true },
    { name: 'Brainstorm', type: 'Normal', tcg: 'Magic', is_active: true },
    { name: 'Counterspell', type: 'Normal', tcg: 'Magic', is_active: true },
    { name: 'Dark Ritual', type: 'Normal', tcg: 'Magic', is_active: true },
    { name: 'Lightning Helix', type: 'Normal', tcg: 'Magic', is_active: true },
    { name: 'Path to Exile', type: 'Normal', tcg: 'Magic', is_active: true },
    { name: 'Swords to Plowshares', type: 'Normal', tcg: 'Magic', is_active: true },
    { name: 'Lightning Bolt', type: 'Foil', tcg: 'Magic', is_active: true },
    { name: 'Black Lotus', type: 'Foil', tcg: 'Magic', is_active: true },
    { name: 'Mox Sapphire', type: 'Foil', tcg: 'Magic', is_active: true },
    { name: 'Ancestral Recall', type: 'Foil', tcg: 'Magic', is_active: true },
    { name: 'Brainstorm', type: 'Foil', tcg: 'Magic', is_active: true },
    { name: 'Counterspell', type: 'Foil', tcg: 'Magic', is_active: true },
    { name: 'Dark Ritual', type: 'Foil', tcg: 'Magic', is_active: true },
    { name: 'Lightning Helix', type: 'Foil', tcg: 'Magic', is_active: true },
    { name: 'Path to Exile', type: 'Foil', tcg: 'Magic', is_active: true },
    { name: 'Swords to Plowshares', type: 'Foil', tcg: 'Magic', is_active: true },
    { name: 'Lightning Bolt', type: 'Holo', tcg: 'Magic', is_active: true },
    { name: 'Black Lotus', type: 'Holo', tcg: 'Magic', is_active: true },
    { name: 'Mox Sapphire', type: 'Holo', tcg: 'Magic', is_active: true },
    { name: 'Ancestral Recall', type: 'Holo', tcg: 'Magic', is_active: true },
    { name: 'Brainstorm', type: 'Holo', tcg: 'Magic', is_active: true },
    { name: 'Counterspell', type: 'Holo', tcg: 'Magic', is_active: true },
    { name: 'Dark Ritual', type: 'Holo', tcg: 'Magic', is_active: true },
    { name: 'Lightning Helix', type: 'Holo', tcg: 'Magic', is_active: true },
    { name: 'Path to Exile', type: 'Holo', tcg: 'Magic', is_active: true },
    { name: 'Swords to Plowshares', type: 'Holo', tcg: 'Magic', is_active: true }
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

if (import.meta.url === `file://${process.argv[1]}`) {
  checkCards();
}

export { checkCards, createSampleCards, groupByTcgAndType };
