// ══════════════════════════════════════════════════════
// SENHA — do código de 6 números para senha normal
// ══════════════════════════════════════════════════════
//
// Até aqui o login era um código de 6 números, digitado num teclado desenhado
// pelo app. A migração é suave:
//
// 1. O campo de senha do login aceita qualquer coisa, então o código antigo
//    continua entrando (para o Supabase ele é só uma senha de 6 caracteres).
// 2. Quem entra sem a marca `password_v2` nos metadados do usuário cai numa
//    tela obrigatória: "o portal mudou, crie sua senha".
// 3. Ao salvar a senha nova, a marca é gravada junto. Daí em diante o código
//    deixa de existir: a senha do Supabase passou a ser a nova.
//
// Contas novas já nascem com a marca. A marca fica em `user_metadata`, que o
// próprio usuário pode editar — serve para decidir se mostramos a tela, não
// como controle de segurança.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_V2_FLAG = 'password_v2';

/** Mensagem do que falta na senha nova, ou null se ela serve. */
export function passwordProblem(pw) {
  const s = String(pw ?? '');
  if (s.length < PASSWORD_MIN_LENGTH) return `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres`;
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return 'Inclua pelo menos uma letra';
  if (!/[0-9]/.test(s)) return 'Inclua pelo menos um número';
  return null;
}

/** Checklist para mostrar enquanto a pessoa digita. */
export function passwordChecks(pw) {
  const s = String(pw ?? '');
  return [
    { key: 'length', label: `${PASSWORD_MIN_LENGTH}+ caracteres`, ok: s.length >= PASSWORD_MIN_LENGTH },
    { key: 'letter', label: 'uma letra', ok: /[A-Za-zÀ-ÿ]/.test(s) },
    { key: 'number', label: 'um número', ok: /[0-9]/.test(s) },
  ];
}

/** A conta ainda está no código de 6 números? */
export function needsPasswordUpgrade(user) {
  if (!user) return false;
  return user.user_metadata?.[PASSWORD_V2_FLAG] !== true;
}
