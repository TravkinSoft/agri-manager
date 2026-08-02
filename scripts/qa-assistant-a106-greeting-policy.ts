import assert from "node:assert/strict";
import {
  assistantGreetingInstruction,
  enforceAssistantGreetingPolicy,
  resolveAssistantGreetingPolicy,
} from "@/lib/assistant/v2/greeting-policy";

let passed = 0;

function scenario(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${passed}/4: ${name}`);
}

scenario("Привет -> greeting is allowed and preserved", () => {
  const result = enforceAssistantGreetingPolicy({
    answer: "Привет! Чем помочь?",
    currentUserMessage: "Привет",
    priorMessageCount: 0,
  });
  assert.equal(result.policy.greetingAllowed, true);
  assert.equal(result.answer, "Привет! Чем помочь?");
  assert.equal(result.greetingRemoved, false);
});

scenario("Что ты умеешь? -> repeated greeting is removed", () => {
  const result = enforceAssistantGreetingPolicy({
    answer: "Здравствуйте! Могу отвечать на вопросы и читать данные хозяйства.",
    currentUserMessage: "Что ты умеешь?",
    priorMessageCount: 2,
  });
  assert.equal(result.policy.greetingAllowed, false);
  assert.equal(result.answer, "Могу отвечать на вопросы и читать данные хозяйства.");
  assert.equal(result.greetingRemoved, true);
});

scenario("Какие данные компании? -> DATA answer has no repeated greeting", () => {
  const result = enforceAssistantGreetingPolicy({
    answer: "Мой Господин, привет! Доступны поля, операции и склады.",
    currentUserMessage: "Какие данные компании?",
    priorMessageCount: 4,
  });
  assert.equal(result.policy.greetingAllowed, false);
  assert.equal(result.answer, "Доступны поля, операции и склады.");
  assert.equal(result.greetingRemoved, true);
});

scenario("new thread -> greeting is allowed again", () => {
  const policy = resolveAssistantGreetingPolicy({
    currentUserMessage: "Что ты умеешь?",
    priorMessageCount: 0,
  });
  assert.equal(policy.greetingAllowed, true);
  assert.match(assistantGreetingInstruction(policy), /greeting is allowed/i);
});

console.log("A106_GREETING_REGRESSION=PASS");
console.log(`SCENARIOS_PASS=${passed}`);
console.log("SCENARIOS_FAIL=0");
