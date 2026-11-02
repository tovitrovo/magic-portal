import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { passwordProblem, passwordChecks, needsPasswordUpgrade, PASSWORD_V2_FLAG } from '../shared/passwordPolicy.js';

const app = readFileSync(new URL('../src/MagicPortal.jsx', import.meta.url), 'utf8');

test('a senha nova exige 8+ caracteres com letra e número', () => {
  assert.equal(passwordProblem('123456'), 'Use pelo menos 8 caracteres', 'o código antigo não serve como senha nova');
  assert.equal(passwordProblem('12345678'), 'Inclua pelo menos uma letra');
  assert.equal(passwordProblem('abcdefgh'), 'Inclua pelo menos um número');
  assert.equal(passwordProblem('magic2026'), null);
  assert.equal(passwordProblem('Ação1234'), null, 'letra acentuada conta como letra');
  assert.equal(passwordProblem(undefined), 'Use pelo menos 8 caracteres');
});

test('o checklist acompanha a regra', () => {
  assert.deepEqual(passwordChecks('abc1').map(c => c.ok), [false, true, true]);
  assert.ok(passwordChecks('magic2026').every(c => c.ok));
});

test('só pede a troca para quem ainda não tem a marca', () => {
  assert.equal(needsPasswordUpgrade(null), false, 'sem sessão não há o que trocar');
  assert.equal(needsPasswordUpgrade({ user_metadata: {} }), true);
  assert.equal(needsPasswordUpgrade({}), true);
  assert.equal(needsPasswordUpgrade({ user_metadata: { [PASSWORD_V2_FLAG]: true } }), false);
});

test('cadastro e troca de senha gravam a marca; o teclado de números saiu', () => {
  assert.match(app, /auth\/v1\/signup[\s\S]{0,300}data:\s*\{\s*\[PASSWORD_V2_FLAG\]:\s*true\s*\}/, 'conta nova nasce migrada');
  assert.match(app, /auth\/v1\/user[\s\S]{0,300}data:\s*\{\s*\[PASSWORD_V2_FLAG\]:\s*true\s*\}/, 'trocar a senha grava a marca');
  assert.match(app, /function PasswordUpgradeGate\(/, 'a tela obrigatória existe');
  assert.doesNotMatch(app, /function VirtualKeyboard\(/, 'o teclado desenhado pelo app era a fonte da lentidão');
});
