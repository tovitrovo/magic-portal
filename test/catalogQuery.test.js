import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCatalogQueries,
  buildLatestCardQuery,
  getUtcDayRange,
  RECENT_CARDS_FILTER,
  VARIANTS_FILTER,
} from '../src/catalogQuery.js';

test('busca o created_at mais alto somente no card game selecionado', () => {
  assert.equal(
    buildLatestCardQuery('Pokemon'),
    'select=created_at&is_active=eq.true&tcg=eq.Pokemon&created_at=not.is.null&order=created_at.desc&limit=1',
  );
});

test('calcula o dia UTC inteiro do created_at mais recente', () => {
  assert.deepEqual(getUtcDayRange('2026-06-05T23:45:12.000Z'), {
    start: '2026-06-05T00:00:00.000Z',
    end: '2026-06-06T00:00:00.000Z',
  });
});

test('Mais recentes filtra somente pelo dia de created_at e mantém busca e TCG', () => {
  const { cardsQuery, countQuery } = buildCatalogQueries({
    tcg: 'Magic',
    filter: RECENT_CARDS_FILTER,
    search: 'Aang',
    page: 0,
    pageSize: 20,
    latestCreatedAt: '2026-06-05T18:30:00.000Z',
  });

  for (const query of [cardsQuery, countQuery]) {
    assert.match(query, /tcg=eq\.Magic/);
    assert.match(query, /created_at=gte\.2026-06-05T00%3A00%3A00\.000Z/);
    assert.match(query, /created_at=lt\.2026-06-06T00%3A00%3A00\.000Z/);
    assert.match(query, /name=ilike\.\*Aang\*/);
    assert.doesNotMatch(query, /type=eq\./);
  }
  assert.match(cardsQuery, /order=created_at\.desc/);
});

test('filtros existentes continuam filtrando por tipo e ordenando por nome', () => {
  for (const filter of ['Normal', 'Holo', 'Foil']) {
    const { cardsQuery } = buildCatalogQueries({
      tcg: 'Magic',
      filter,
      search: '',
      page: 0,
      pageSize: 20,
    });
    assert.match(cardsQuery, new RegExp(`type=eq\\.${filter}`));
    assert.match(cardsQuery, /order=name/);
    assert.doesNotMatch(cardsQuery, /created_at=gte/);
  }
});

test('Todos não adiciona restrição de tipo nem de data', () => {
  const { cardsQuery } = buildCatalogQueries({
    tcg: 'Magic',
    filter: 'Todos',
    search: '',
    page: 0,
    pageSize: 20,
  });
  assert.doesNotMatch(cardsQuery, /type=eq\./);
  assert.doesNotMatch(cardsQuery, /created_at=gte/);
  assert.match(cardsQuery, /order=name/);
});

test('Variantes sem escolha lista toda carta com variante; com escolha filtra por ela', () => {
  const base = { tcg: 'Magic', search: '', page: 0, pageSize: 20, filter: VARIANTS_FILTER };
  const all = buildCatalogQueries(base);
  for (const query of [all.cardsQuery, all.countQuery]) {
    assert.match(query, /variant=not\.is\.null/);
    assert.doesNotMatch(query, /type=eq\./);
  }
  const surge = buildCatalogQueries({ ...base, variant: 'Surge Foil' });
  assert.match(surge.cardsQuery, /variant=eq\.Surge%20Foil/);
  assert.match(surge.countQuery, /variant=eq\.Surge%20Foil/);
  assert.match(surge.cardsQuery, /select=id,name,type,variant,/);
});
