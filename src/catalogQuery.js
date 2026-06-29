export const RECENT_CARDS_FILTER = 'Mais recentes';

function encode(value) {
  return encodeURIComponent(String(value));
}

export function getUtcDayRange(createdAt) {
  const latestDate = new Date(createdAt);
  if (Number.isNaN(latestDate.getTime())) {
    throw new Error('Data de criação inválida para o filtro de cartas recentes.');
  }

  const start = new Date(Date.UTC(
    latestDate.getUTCFullYear(),
    latestDate.getUTCMonth(),
    latestDate.getUTCDate(),
  ));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start: start.toISOString(), end: end.toISOString() };
}

export function buildLatestCardQuery(tcg) {
  return `select=created_at&is_active=eq.true&tcg=eq.${encode(tcg)}&created_at=not.is.null&order=created_at.desc&limit=1`;
}

export function buildCatalogQueries({ tcg, filter, search, page, pageSize, latestCreatedAt }) {
  let filters = `is_active=eq.true&tcg=eq.${encode(tcg)}`;
  let order = 'name';

  if (filter === RECENT_CARDS_FILTER) {
    const { start, end } = getUtcDayRange(latestCreatedAt);
    filters += `&created_at=gte.${encode(start)}&created_at=lt.${encode(end)}`;
    order = 'created_at.desc';
  } else if (filter !== 'Todos') {
    filters += `&type=eq.${encode(filter)}`;
  }

  if (search) {
    filters += `&name=ilike.*${encode(search)}*`;
  }

  return {
    cardsQuery: `select=id,name,type,image_url,created_at,is_lot,price_brl&${filters}&order=${order}&limit=${pageSize}&offset=${page * pageSize}`,
    countQuery: `select=id&${filters}`,
  };
}
