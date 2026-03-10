/**
 * Placeholder após remoção do sistema de bônus por porcentagem (BONUS_PCT).
 * O único tipo de bônus automático restante é TIER_CHANGE (ver tier-bonus.js).
 * Bônus manuais continuam sendo concedidos via admin-bonus.js.
 *
 * Esta função é mantida para não quebrar imports existentes,
 * mas não faz mais nada.
 */

export async function grantBonusOnPaid(_sbUrl, _sbKey, _batchId) {
  // BONUS_PCT removido. Nenhuma ação necessária.
}
