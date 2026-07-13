const fs = require("fs");
const path = require("path");

// 서버 환경변수를 브라우저용 runtime-config.js로 굽습니다.
// 비밀 값(API 키/서명 시크릿)은 절대 여기서 내보내지 않습니다.
const entryCoinPrice = Number(process.env.ENTRY_COIN_PRICE || 100);
if (!Number.isInteger(entryCoinPrice) || entryCoinPrice < 0) {
  console.error("ENTRY_COIN_PRICE는 0 이상의 정수여야 합니다.");
  process.exit(1);
}
const winReward = Number(process.env.WIN_REWARD_COINS || 200);
if (!Number.isInteger(winReward) || winReward < 0) {
  console.error("WIN_REWARD_COINS는 0 이상의 정수여야 합니다.");
  process.exit(1);
}
const allowTestNickname = process.env.ALLOW_TEST_NICKNAME === "true";

const runtimePath = path.join(__dirname, "..", "js", "runtime-config.js");
fs.writeFileSync(
  runtimePath,
  `export const ENTRY_COIN_PRICE = ${entryCoinPrice};\n` +
  `export const WIN_REWARD_COINS = ${winReward};\n` +
  `export const ALLOW_TEST_NICKNAME = ${allowTestNickname};\n`
);
console.log(`runtime-config.js generated at ${runtimePath} (entry=${entryCoinPrice}, win=${winReward}, test=${allowTestNickname})`);
