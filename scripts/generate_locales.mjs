import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DERIVED_STAT_LABELS, getDefaultSourceTablesPath } from "./lib/raw_pipeline.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = path.join(rootDir, "site");
const localesPath = path.join(siteDir, "data", "locales.json");
const locales = ["zh-tw", "en", "ja", "ko"];
const compareStrings = (left, right) => {
  const leftValue = String(left);
  const rightValue = String(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
};

// Unlock labels are presentation mappings only.  Numeric thresholds must be
// supplied by the generated canonical node and are never maintained here.
const LEGACY_UNLOCK_KEYS = Object.freeze({
  REWARD_UNLOCKED: "unlock.weeklyMission",
  COOP_REWARD_UNLOCKED: "unlock.bountyReward",
  ARENA_REWARD_UNLOCKED: "unlock.arenaPass",
  COOP_KILL_COUNT: "unlock.coopKills"
});

// Normalize a small set of source rows with positional-token corrections
// before publishing the runtime catalog.
const SOURCE_FORMAT_PATCHES = {
  TriggerRebloomOnNewFlower_desc: {
    en: "When a new Flower Dice activates <tag>BLOOM</tag>, activates all inactive Flower Dice on the field <tag>BLOOM</tag>"
  },
  PotionBounceToOtherDice_desc: {
    en: "<tag>POTION</tag> bounces {0} times, applying its effect to nearby dice"
  },
  AlignmentBuffPerStack_desc: {
    en: "Further increases the buff by {0}% based on the number of <tag>ALIGNMENT</tag> stacks"
  },
  TyrantConsumeDmgPerStack_desc: {
    ko: "폭군 주사위가 다른 폭군 주사위 제거할 때마다 대미지 증가(최대 {1}중첩)"
  },
  tactics_desc_BombDiceSpawnOnMerge: {
    en: "For {4} sec, merging has a {0}% chance to spawn a Bomb Dice"
  },
  target_rangefront: {
    "zh-tw": "範圍內",
    en: "Within range",
    ja: "範囲内",
    ko: "범위 내"
  },
  // RuneTable kind 53 stores Value2 as a signed rotation-interval modifier
  // (-0.5 sec). The client templates incorrectly present that value as an
  // effect duration, producing the ambiguous "rotation speed for 0.5 sec
  // (max 5 sec)" sentence. Keep the raw table values in the canonical
  // snapshot, but publish a conservative semantic translation: the interval
  // is shortened by 0.5 sec and the effect lasts at most 5 sec. The raw data
  // does not prove that 5 means five stacks, so the generated wording must
  // not assert a stack count.
  ElementDefenderRotationSpeedIncrease_desc: {
    "zh-tw": "每{0}秒使<tag>ELEMENT</tag>的旋轉週期縮短{2}秒，效果最多持續{4}秒",
    en: "Every {0} sec, shortens the <tag>ELEMENT</tag> rotation interval by {2} sec; the effect lasts up to {4} sec",
    ja: "{0}秒ごとに<tag>ELEMENT</tag>の回転間隔を{2}秒短縮し、効果は最大{4}秒間持続",
    ko: "{0}초마다 <tag>ELEMENT</tag>의 회전 주기를 {2}초 줄이며, 효과는 최대 {4}초 동안 지속됩니다"
  }
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readRows(sourceDir, filename, headerPredicate) {
  const file = path.join(sourceDir, filename);
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const headerIndex = rows.findIndex((row) => headerPredicate(row));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map((value) => String(value || "").trim());
  return rows.slice(headerIndex + 1)
    .filter((row) => row.some((value) => String(value || "").trim() !== ""))
    .map((row) => Object.fromEntries(header.map((key, index) => [key, String(row[index] ?? "").trim()])));
}

function completeEntry(values) {
  return locales.length > 0 && locales.every((locale) => String(values?.[locale] ?? "").trim() !== "");
}

function slug(value) {
  const normalized = String(value || "").normalize("NFKD");
  let result = "";
  let separatorPending = false;
  for (const character of normalized) {
    const code = character.codePointAt(0);
    const isAsciiLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const isAsciiDigit = code >= 48 && code <= 57;
    if (isAsciiLetter || isAsciiDigit) {
      if (separatorPending && result) result += "_";
      result += character.toLowerCase();
      separatorPending = false;
    } else if (result) {
      separatorPending = true;
    }
  }
  return result;
}

const UI = {
  ...DERIVED_STAT_LABELS,
  "brand.title": { "zh-tw": "RANDOM DICE 2 LAB", en: "RANDOM DICE 2 LAB", ja: "RANDOM DICE 2 LAB", ko: "RANDOM DICE 2 LAB" },
  "brand.subtitle": { "zh-tw": "DATA EXPLORER", en: "DATA EXPLORER", ja: "DATA EXPLORER", ko: "DATA EXPLORER" },
  "brand.metaDescription": { "zh-tw": "Random Dice 2 Lab：版本化骰子樹資料、圖鑑、配點工具與更新日誌。", en: "Random Dice 2 Lab: versioned dice tree data, compendium, planning tools, and changelog.", ja: "Random Dice 2 Lab：バージョン管理されたダイスツリーデータ、図鑑、ビルドツール、更新履歴。", ko: "Random Dice 2 Lab: 버전 관리 주사위 트리 데이터, 도감, 빌드 도구 및 변경 기록." },
  "brand.siteName": { "zh-tw": "Random Dice 2 Lab", en: "Random Dice 2 Lab", ja: "Random Dice 2 Lab", ko: "Random Dice 2 Lab" },
  "brand.seoTitle": { "zh-tw": "Random Dice 2 Lab｜骰子樹、圖鑑與配點工具", en: "Random Dice 2 Lab | Dice tree, compendium, and build planner", ja: "Random Dice 2 Lab｜ダイスツリー・図鑑・ビルドプランナー", ko: "Random Dice 2 Lab | 주사위 트리·도감·빌드 플래너" },
  "brand.intro": { "zh-tw": "查閱 Random Dice 2 的版本化骰子樹、骰子與事件圖鑑，並在模擬配點中規劃可分享的建構。", en: "Explore versioned Random Dice 2 dice-tree data, dice and event compendia, and shareable build planning.", ja: "Random Dice 2 のバージョン管理されたダイスツリー、ダイス・イベント図鑑、共有できるビルド計画を確認できます。", ko: "버전별 Random Dice 2 주사위 트리와 주사위·이벤트 도감을 살펴보고 공유 가능한 빌드를 계획하세요." },
  "brand.ogImageAlt": { "zh-tw": "Random Dice 2 Lab 骰子樹預覽", en: "Random Dice 2 Lab dice tree preview", ja: "Random Dice 2 Lab ダイスツリープレビュー", ko: "Random Dice 2 Lab 주사위 트리 미리보기" },
  "seo.nodeTitle": { "zh-tw": "{name}｜Random Dice 2 Lab 節點", en: "{name} | Random Dice 2 Lab node", ja: "{name}｜Random Dice 2 Lab ノード", ko: "{name} | Random Dice 2 Lab 노드" },
  "seo.nodeDescription": { "zh-tw": "{name} 的骰子樹節點資料：{description}", en: "{name} dice-tree node data: {description}", ja: "{name} のダイスツリーノードデータ：{description}", ko: "{name} 주사위 트리 노드 데이터: {description}" },
  "seo.compendiumTitle": { "zh-tw": "{name}｜Random Dice 2 Lab 圖鑑", en: "{name} | Random Dice 2 Lab compendium", ja: "{name}｜Random Dice 2 Lab 図鑑", ko: "{name} | Random Dice 2 Lab 도감" },
  "seo.compendiumDescription": { "zh-tw": "{name} 的 Random Dice 2 圖鑑資料：{description}", en: "{name} compendium entry for Random Dice 2: {description}", ja: "Random Dice 2 の{name}図鑑データ：{description}", ko: "Random Dice 2 {name} 도감 데이터: {description}" },
  "seo.compendiumCategoryTitle": { "zh-tw": "{category}｜Random Dice 2 Lab 圖鑑", en: "{category} | Random Dice 2 Lab compendium", ja: "{category}｜Random Dice 2 Lab 図鑑", ko: "{category} | Random Dice 2 Lab 도감" },
  "seo.compendiumCategoryDescription": { "zh-tw": "瀏覽 Random Dice 2 的{category}資料與參考條目。", en: "Browse Random Dice 2 {category} data and reference entries.", ja: "Random Dice 2 の{category}データと参照項目を確認できます。", ko: "Random Dice 2 {category} 데이터와 참고 항목을 확인하세요." },
  "seo.simulationTitle": { "zh-tw": "模擬配點｜Random Dice 2 Lab", en: "Build simulation | Random Dice 2 Lab", ja: "ビルドシミュレーション｜Random Dice 2 Lab", ko: "빌드 시뮬레이션 | Random Dice 2 Lab" },
  "seo.simulationDescription": { "zh-tw": "規劃 Random Dice 2 配點、比較解鎖消耗，並分享建構結果。", en: "Plan a Random Dice 2 build, compare unlock costs, and share the result.", ja: "Random Dice 2 のビルドを計画し、解放コストを比較して結果を共有できます。", ko: "Random Dice 2 빌드를 계획하고 해금 비용을 비교하며 결과를 공유하세요." },
  "loader.loading": { "zh-tw": "正在載入骰子樹資料…", en: "Loading dice tree data…", ja: "ダイスツリーのデータを読み込み中…", ko: "주사위 트리 데이터를 불러오는 중…" },
  "loader.reading": { "zh-tw": "讀取節點資料…", en: "Reading node data…", ja: "ノードデータを読み込み中…", ko: "노드 데이터를 읽는 중…" },
  "loader.parsing": { "zh-tw": "解析 {count} 個節點…", en: "Parsing {count} nodes…", ja: "{count}個のノードを解析中…", ko: "{count}개 노드를 분석하는 중…" },
  "loader.rendering": { "zh-tw": "繪製骰子樹圖層…", en: "Rendering the dice tree…", ja: "ダイスツリーを描画中…", ko: "주사위 트리를 그리는 중…" },
  "loader.edges": { "zh-tw": "建立節點連線…", en: "Linking node paths…", ja: "ノードの接続を構築中…", ko: "노드 연결을 구성하는 중…" },
  "loader.prerequisites": { "zh-tw": "計算前置解鎖路徑…", en: "Computing prerequisite paths…", ja: "前提解放経路を計算中…", ko: "선행 해금 경로를 계산하는 중…" },
  "loader.search": { "zh-tw": "建立搜尋索引…", en: "Building the search index…", ja: "検索インデックスを構築中…", ko: "검색 색인을 만드는 중…" },
  "loader.geometry": { "zh-tw": "計算節點幾何…", en: "Computing node geometry…", ja: "ノードの配置を計算中…", ko: "노드 배치를 계산하는 중…" },
  "loader.cache": { "zh-tw": "準備資訊卡片…", en: "Preparing detail cards…", ja: "詳細カードを準備中…", ko: "상세 카드를 준비하는 중…" },
  "loader.minimap": { "zh-tw": "產生全景小地圖…", en: "Preparing the minimap…", ja: "ミニマップを準備中…", ko: "미니맵을 준비하는 중…" },
  "loader.complete": { "zh-tw": "載入完成", en: "Ready", ja: "読み込み完了", ko: "로드 완료" },
  "loader.failed": { "zh-tw": "資料載入失敗，請重新載入。", en: "Data loading failed. Reload to try again.", ja: "データの読み込みに失敗しました。再読み込みしてください。", ko: "데이터를 불러오지 못했습니다. 다시 로드해 주세요." },
  "loader.retry": { "zh-tw": "重新載入", en: "Reload", ja: "再読み込み", ko: "다시 로드" },
  "loader.retrying": { "zh-tw": "重新載入中…", en: "Reloading…", ja: "再読み込み中…", ko: "다시 로드하는 중…" },
  "search.label": { "zh-tw": "搜尋骰子樹節點", en: "Search dice tree nodes", ja: "ダイスツリーのノードを検索", ko: "주사위 트리 노드 검색" },
  "search.placeholder": { "zh-tw": "搜尋骰子、符文、被動與技能關鍵字…", en: "Search dice, runes, passives, and skill keywords…", ja: "ダイス、ルーン、パッシブ、スキルを検索…", ko: "주사위, 룬, 패시브, 스킬 키워드 검색…" },
  "compendium.searchPlaceholder": { "zh-tw": "搜尋圖鑑內容…", en: "Search the compendium…", ja: "図鑑を検索…", ko: "도감 검색…" },
  "compendium.searchLabel": { "zh-tw": "搜尋圖鑑內容", en: "Search the compendium", ja: "図鑑を検索", ko: "도감 검색" },
  "search.clear": { "zh-tw": "清除搜尋內容", en: "Clear search", ja: "検索を消去", ko: "검색 지우기" },
  "search.results": { "zh-tw": "搜尋結果", en: "Search results", ja: "検索結果", ko: "검색 결과" },
  "search.count": { "zh-tw": "{count} 個節點", en: "{count} nodes", ja: "{count}個のノード", ko: "노드 {count}개" },
  "search.empty": { "zh-tw": "找不到符合條件的節點", en: "No matching nodes", ja: "条件に一致するノードはありません", ko: "조건에 맞는 노드가 없습니다" },
  "filter.label": { "zh-tw": "篩選", en: "Filter", ja: "フィルター", ko: "필터" },
  "filter.badge": { "zh-tw": "篩選", en: "FILTER", ja: "フィルター", ko: "필터" },
  "filter.clearAll": { "zh-tw": "清除所有篩選", en: "Clear all filters", ja: "すべてのフィルターを解除", ko: "모든 필터 지우기" },
  "filter.title": { "zh-tw": "條件篩選", en: "Filters", ja: "条件フィルター", ko: "조건 필터" },
  "filter.faction": { "zh-tw": "陣營", en: "Faction", ja: "勢力", ko: "진영" },
  "filter.type": { "zh-tw": "類型", en: "Type", ja: "種類", ko: "유형" },
  "filter.clear": { "zh-tw": "清除", en: "Clear", ja: "クリア", ko: "지우기" },
  "filter.close": { "zh-tw": "關閉篩選面板", en: "Close filter panel", ja: "フィルターパネルを閉じる", ko: "필터 패널 닫기" },
  "node.type.dice": { "zh-tw": "骰子", en: "Dice", ja: "ダイス", ko: "주사위" },
  "node.type.dice_rune": { "zh-tw": "骰子符文", en: "Dice rune", ja: "ダイスルーン", ko: "주사위 룬" },
  "node.type.passive": { "zh-tw": "全域被動", en: "Global passive", ja: "全体パッシブ", ko: "전체 패시브" },
  "node.type.perk": { "zh-tw": "支援", en: "Support", ja: "サポート", ko: "지원" },
  "target.front": { "zh-tw": "前方", en: "Front", ja: "先頭", ko: "앞" },
  "target.random": { "zh-tw": "隨機", en: "Random", ja: "ランダム", ko: "무작위" },
  "target.all": { "zh-tw": "全部", en: "All", ja: "全体", ko: "전체" },
  "target.none": { "zh-tw": "-", en: "-", ja: "-", ko: "-" },
  "unlock.prerequisite": { "zh-tw": "前置節點", en: "Prerequisite node", ja: "前提ノード", ko: "선행 노드" },
  "unlock.nature": { "zh-tw": "自然等級", en: "Nature level", ja: "自然レベル", ko: "자연 레벨" },
  "unlock.engineering": { "zh-tw": "工學等級", en: "Engineering level", ja: "工学レベル", ko: "공학 레벨" },
  "unlock.magic": { "zh-tw": "魔法等級", en: "Magic level", ja: "魔法レベル", ko: "마법 레벨" },
  "unlock.guardian": { "zh-tw": "秩序等級", en: "Order level", ja: "秩序レベル", ko: "질서 레벨" },
  "unlock.invader": { "zh-tw": "渾沌等級", en: "Chaos level", ja: "カオスレベル", ko: "혼돈 레벨" },
  "unlock.weeklyMission": { "zh-tw": "七日任務", en: "Seven-day mission", ja: "7日ミッション", ko: "7일 임무" },
  "unlock.bountyReward": { "zh-tw": "討伐獎勵", en: "Bounty reward", ja: "討伐報酬", ko: "토벌 보상" },
  "unlock.arenaPass": { "zh-tw": "競技場通行證", en: "Arena pass", ja: "アリーナパス", ko: "아레나 패스" },
  "unlock.coopKills": { "zh-tw": "合作擊殺數", en: "Co-op kills", ja: "協力撃破数", ko: "협동 처치 수" },
  "map.label": { "zh-tw": "可互動骰子樹", en: "Interactive dice tree", ja: "インタラクティブなダイスツリー", ko: "대화형 주사위 트리" },
  "map.nodes": { "zh-tw": "骰子樹節點", en: "Dice tree nodes", ja: "ダイスツリーのノード", ko: "주사위 트리 노드" },
  "map.minimap": { "zh-tw": "骰子樹全景小地圖", en: "Dice tree minimap", ja: "ダイスツリーのミニマップ", ko: "주사위 트리 미니맵" },
  "map.minimapLocate": { "zh-tw": "點擊小地圖定位視野", en: "Click the minimap to move the view", ja: "ミニマップをクリックして表示位置を移動", ko: "미니맵을 클릭해 화면 이동" },
  "map.minimapAlt": { "zh-tw": "骰子樹全圖縮圖", en: "Dice tree overview", ja: "ダイスツリー全体の縮小図", ko: "주사위 트리 전체 미리보기" },
  "hud.group": { "zh-tw": "地圖輔助檢視功能", en: "Map display options", ja: "マップ表示オプション", ko: "지도 표시 옵션" },
  "hud.prereq": { "zh-tw": "查看前置節點", en: "Show prerequisites", ja: "前提ノードを表示", ko: "선행 노드 보기" },
  "hud.prereqTitle": { "zh-tw": "開啟後選取節點將標示其所有前置節點路徑", en: "Show every prerequisite path when a node is selected", ja: "ノード選択時に前提ノードへの経路を表示", ko: "노드를 선택하면 모든 선행 경로 표시" },
  "hud.names": { "zh-tw": "查看名稱", en: "Show names", ja: "名前を表示", ko: "이름 보기" },
  "hud.namesTitle": { "zh-tw": "在節點上方顯示節點名稱（不含符文）", en: "Show node names above nodes (runes excluded)", ja: "ノード名を表示（ルーンを除く）", ko: "노드 이름 표시(룬 제외)" },
  "hud.currency": { "zh-tw": "查看貨幣", en: "Show costs", ja: "コストを表示", ko: "비용 보기" },
  "hud.currencyTitle": { "zh-tw": "在所有節點上方顯示解鎖消耗", en: "Show unlock costs above every node", ja: "すべてのノードに解放コストを表示", ko: "모든 노드에 해금 비용 표시" },
  "hud.stats": { "zh-tw": "詳細能力", en: "Detailed stats", ja: "詳細ステータス", ko: "상세 능력치" },
  "hud.statsTitle": { "zh-tw": "查看詳細能力加總", en: "View detailed stat totals", ja: "詳細ステータスの合計を表示", ko: "상세 능력치 합계 보기" },
  "hud.simulation": { "zh-tw": "模擬配點", en: "Build simulation", ja: "ビルドシミュレーション", ko: "빌드 시뮬레이션" },
  "hud.simulationTitle": { "zh-tw": "開啟模擬配點模式", en: "Open build simulation mode", ja: "ビルドシミュレーションを開く", ko: "빌드 시뮬레이션 열기" },
  "status.interaction": { "zh-tw": "拖曳移動視野・點擊節點查看詳情", en: "Drag to move the view · click a node for details", ja: "ドラッグで移動・ノードをクリックして詳細を表示", ko: "드래그해 이동 · 노드를 클릭해 상세 정보 보기" },
  "status.shortcuts": { "zh-tw": "縮放　重設　搜尋　關閉", en: "Zoom　Reset　Search　Close", ja: "ズーム　リセット　検索　閉じる", ko: "확대/축소　초기화　검색　닫기" },
  "widget.disclaimer.label": { "zh-tw": "聲明與版權", en: "Project notice", ja: "お知らせと著作権", ko: "안내 및 저작권" },
  "widget.disclaimer.open": { "zh-tw": "查看專案聲明", en: "View project notice", ja: "プロジェクトのお知らせを見る", ko: "프로젝트 안내 보기" },
  "widget.disclaimer.title": { "zh-tw": "玩家製作專案", en: "Player-made project", ja: "プレイヤー制作プロジェクト", ko: "플레이어 제작 프로젝트" },
  "widget.disclaimer.close": { "zh-tw": "關閉聲明", en: "Close notice", ja: "お知らせを閉じる", ko: "안내 닫기" },
  "widget.disclaimer.badge": { "zh-tw": "玩家製作", en: "FAN-MADE", ja: "ファン制作", ko: "팬 제작" },
  "disclaimer.item.community": { "zh-tw": "<strong>玩家製作</strong>：這是玩家維護的攻略資料庫與配點模擬器，與《Random Dice 2》及 <strong>111 Percent Inc.</strong> 沒有隸屬、授權或背書關係。", en: "<strong>Player-made</strong>: Players maintain this guide and build planner. It is not affiliated with, authorized by, or endorsed by <strong>111 Percent Inc.</strong>.", ja: "<strong>プレイヤー制作</strong>：プレイヤーが運営する攻略データベースとビルドシミュレーターです。<strong>111 Percent Inc.</strong>およびRandom Dice 2とは、提携・許諾・公式の推薦関係はありません。", ko: "<strong>플레이어 제작</strong>: 이 가이드와 빌드 플래너는 플레이어가 운영합니다. <strong>111 Percent Inc.</strong> 또는 Random Dice 2와 제휴·허가·공식 후원 관계가 없습니다." },
  "disclaimer.item.rights": { "zh-tw": "<strong>著作權</strong>：遊戲中的美術、圖示、音效、文字、數值與商標，均歸 <strong>111 Percent Inc.</strong> 及各原權利人所有。", en: "<strong>Copyright</strong>: The game's art, icons, sound, text, balance data, and trademarks belong to <strong>111 Percent Inc.</strong> and their respective owners.", ja: "<strong>著作権</strong>：ゲームのアート、アイコン、音声、テキスト、数値、商標は、<strong>111 Percent Inc.</strong>および各権利者に帰属します。", ko: "<strong>저작권</strong>: 게임의 아트, 아이콘, 사운드, 텍스트, 수치 및 상표의 권리는 <strong>111 Percent Inc.</strong>와 각 권리자에게 있습니다." },
  "disclaimer.item.nonprofit": { "zh-tw": "<strong>使用方式</strong>：本站不放廣告，也沒有付費功能；內容僅供玩家查閱、試算與交流。", en: "<strong>Use</strong>: There are no ads or paid features. The site is for reference, planning, and discussion.", ja: "<strong>利用について</strong>：広告や有料機能はありません。情報の確認、配点の試算、プレイヤー同士の交流にご利用ください。", ko: "<strong>이용 안내</strong>: 광고나 유료 기능은 없습니다. 정보 확인, 빌드 계산 및 플레이어 간 교류를 위한 사이트입니다." },
  "disclaimer.takedown": { "zh-tw": "若您是 111 Percent Inc. 的代表，希望移除任何資產，請聯絡 <a href=\"mailto:itsestrella71@gmail.com\" class=\"disclaimer-inline-link\">itsestrella71@gmail.com</a>，我們會立即處理。", en: "If you represent 111 Percent Inc. and would like any asset removed, please contact <a href=\"mailto:itsestrella71@gmail.com\" class=\"disclaimer-inline-link\">itsestrella71@gmail.com</a> and we will act promptly.", ja: "111 Percent Inc. の関係者で、資産の削除を希望される場合は <a href=\"mailto:itsestrella71@gmail.com\" class=\"disclaimer-inline-link\">itsestrella71@gmail.com</a> までご連絡ください。速やかに対応します。", ko: "111 Percent Inc. 관계자이며 자산 삭제를 요청하려면 <a href=\"mailto:itsestrella71@gmail.com\" class=\"disclaimer-inline-link\">itsestrella71@gmail.com</a>로 연락해 주세요. 신속히 처리하겠습니다." },
  "disclaimer.contact": { "zh-tw": "下架申請／資料回報：", en: "Takedown or data correction:", ja: "削除依頼／データ修正：", ko: "삭제 요청 또는 데이터 수정:" },
  "disclaimer.emailTitle": { "zh-tw": "聯絡維護者", en: "Contact the maintainer", ja: "メンテナーに連絡", ko: "유지 관리자에게 연락" },
  "widget.language.label": { "zh-tw": "語言", en: "Language", ja: "言語", ko: "언어" },
  "widget.language.open": { "zh-tw": "選擇顯示語言", en: "Choose display language", ja: "表示言語を選択", ko: "표시 언어 선택" },
  "widget.language.title": { "zh-tw": "顯示語言", en: "Display language", ja: "表示言語", ko: "표시 언어" },
  "widget.language.close": { "zh-tw": "關閉語言選擇", en: "Close language selector", ja: "言語選択を閉じる", ko: "언어 선택 닫기" },
  "widget.language.badge": { "zh-tw": "語言", en: "LANGUAGE", ja: "言語", ko: "언어" },
  "widget.changelog.label": { "zh-tw": "遊戲資料版本與更新日誌", en: "Game data version and changelog", ja: "ゲームデータのバージョンと更新履歴", ko: "게임 데이터 버전 및 변경 기록" },
  "widget.changelog.open": { "zh-tw": "查看遊戲資料更新日誌", en: "View the game data changelog", ja: "ゲームデータの更新履歴を表示", ko: "게임 데이터 변경 기록 보기" },
  "widget.changelog.title": { "zh-tw": "更新日誌", en: "Changelog", ja: "更新履歴", ko: "변경 기록" },
  "widget.changelog.close": { "zh-tw": "關閉更新日誌", en: "Close changelog", ja: "更新履歴を閉じる", ko: "변경 기록 닫기" },
  "compendium.label": { "zh-tw": "全骰子圖鑑", en: "Dice compendium", ja: "ダイス図鑑", ko: "주사위 도감" },
  "compendium.titleSuffix": { "zh-tw": "圖鑑", en: "Compendium", ja: "図鑑", ko: "도감" },
  "compendium.centerTitle": { "zh-tw": "圖鑑", en: "Compendium", ja: "図鑑", ko: "도감" },
  "compendium.simulationCenterTitle": { "zh-tw": "骰子樹", en: "Dice tree", ja: "ダイスツリー", ko: "주사위 트리" },
  "compendium.back": { "zh-tw": "返回骰子樹", en: "Back to dice tree", ja: "ダイスツリーに戻る", ko: "주사위 트리로 돌아가기" },
  "compendium.category": { "zh-tw": "圖鑑分類", en: "Compendium category", ja: "図鑑カテゴリ", ko: "도감 분류" },
  "compendium.categoryChoose": { "zh-tw": "選擇圖鑑分類", en: "Choose a compendium category", ja: "図鑑カテゴリを選択", ko: "도감 분류 선택" },
  "compendium.dice": { "zh-tw": "骰子", en: "Dice", ja: "ダイス", ko: "주사위" },
  "compendium.monster": { "zh-tw": "怪物", en: "Monsters", ja: "モンスター", ko: "몬스터" },
  "compendium.event": { "zh-tw": "事件", en: "Events", ja: "イベント", ko: "이벤트" },
  "compendium.all": { "zh-tw": "全部", en: "All", ja: "すべて", ko: "전체" },
  "compendium.modeAll": { "zh-tw": "全部模式", en: "All modes", ja: "すべてのモード", ko: "모든 모드" },
  "compendium.coop": { "zh-tw": "合作模式", en: "Co-op", ja: "協力", ko: "협동" },
  "compendium.versus": { "zh-tw": "競技場", en: "Arena", ja: "アリーナ", ko: "아레나" },
  "compendium.normal": { "zh-tw": "一般", en: "Normal", ja: "通常", ko: "일반" },
  "compendium.hard": { "zh-tw": "困難", en: "Hard", ja: "ハード", ko: "어려움" },
  "compendium.viewMode": { "zh-tw": "圖鑑顯示模式", en: "Compendium view mode", ja: "図鑑の表示モード", ko: "도감 표시 모드" },
  "compendium.viewCards": { "zh-tw": "詳情卡片模式", en: "Card view", ja: "カード表示", ko: "카드 보기" },
  "compendium.viewGrid": { "zh-tw": "網格模式", en: "Grid view", ja: "グリッド表示", ko: "그리드 보기" },
  "compendium.categoryOptions": { "zh-tw": "圖鑑分類選項", en: "Compendium category options", ja: "図鑑カテゴリの選択肢", ko: "도감 분류 옵션" },
  "compendium.sortOptions": { "zh-tw": "排序選項", en: "Sort options", ja: "並び順の選択肢", ko: "정렬 옵션" },
  "compendium.cards": { "zh-tw": "卡片", en: "Cards", ja: "カード", ko: "카드" },
  "compendium.grid": { "zh-tw": "網格", en: "Grid", ja: "グリッド", ko: "그리드" },
  "compendium.sort": { "zh-tw": "排序方式", en: "Sort order", ja: "並び順", ko: "정렬 기준" },
  "compendium.sortChoose": { "zh-tw": "選擇排序方式", en: "Choose sort order", ja: "並び順を選択", ko: "정렬 기준 선택" },
  "compendium.sortDefault": { "zh-tw": "預設排序", en: "Default order", ja: "デフォルト順", ko: "기본 정렬" },
  "compendium.sortDamage": { "zh-tw": "攻擊力 (高到低)", en: "Attack (high to low)", ja: "攻撃力（高い順）", ko: "공격력 (높은 순)" },
  "compendium.sortSpeed": { "zh-tw": "攻擊速度 (快到慢)", en: "Attack speed (fast to slow)", ja: "攻撃速度（速い順）", ko: "공격 속도 (빠른 순)" },
  "compendium.sortName": { "zh-tw": "名稱排序", en: "Name", ja: "名前順", ko: "이름순" },
  "compendium.empty": { "zh-tw": "找不到符合條件的骰子", en: "No matching dice", ja: "条件に一致するダイスはありません", ko: "조건에 맞는 주사위가 없습니다" },
  "compendium.close": { "zh-tw": "關閉骰子詳情", en: "Close dice details", ja: "ダイス詳細を閉じる", ko: "주사위 상세 닫기" },
  "common.close": { "zh-tw": "關閉", en: "Close", ja: "閉じる", ko: "닫기" },
  "common.cancel": { "zh-tw": "取消", en: "Cancel", ja: "キャンセル", ko: "취소" },
  "common.save": { "zh-tw": "儲存", en: "Save", ja: "保存", ko: "저장" },
  "common.unknown": { "zh-tw": "未知", en: "Unknown", ja: "不明", ko: "알 수 없음" },
  "common.comingSoon": { "zh-tw": "即將推出…", en: "Coming soon…", ja: "近日公開…", ko: "곧 공개됩니다…" },
  "tooltip.nodeName": { "zh-tw": "節點名稱", en: "Node name", ja: "ノード名", ko: "노드 이름" },
  "tooltip.nodeFallback": { "zh-tw": "未命名節點", en: "Unnamed node", ja: "名前のないノード", ko: "이름 없는 노드" },
  "tooltip.diceIcon": { "zh-tw": "骰子圖示", en: "Dice icon", ja: "ダイスアイコン", ko: "주사위 아이콘" },
  "tooltip.awakening": { "zh-tw": "覺醒效果", en: "Awakening effect", ja: "覚醒効果", ko: "각성 효과" },
  "tooltip.duration": { "zh-tw": "持續時間", en: "Duration", ja: "持続時間", ko: "지속 시간" },
  "tooltip.group": { "zh-tw": "群組", en: "Group", ja: "グループ", ko: "그룹" },
  "tooltip.powerup": { "zh-tw": "強化", en: "Power up", ja: "強化", ko: "강화" },
  "tooltip.dot": { "zh-tw": "提升骰點", en: "Increase pips", ja: "ダイス目を強化", ko: "주사위 눈 강화" },
  "tooltip.bonusDetails": { "zh-tw": "查看{label}加成明細", en: "View {label} bonus details", ja: "{label}の加算詳細を表示", ko: "{label} 보너스 상세 보기" },
  "tooltip.seconds": { "zh-tw": "{value} 秒", en: "{value} sec", ja: "{value}秒", ko: "{value}초" },
  "tooltip.tagLabel": { "zh-tw": "#標籤", en: "#Tag", ja: "#タグ", ko: "#태그" },
  "tooltip.tagFallback": { "zh-tw": "暫無詳細機制說明。", en: "No detailed mechanics are available.", ja: "詳細な仕組みの説明はありません。", ko: "상세한 작동 설명이 없습니다." },
  "tooltip.locate": { "zh-tw": "在地圖中定位", en: "Locate on map", ja: "マップで位置を表示", ko: "지도에서 위치 찾기" },
  "simulation.share": { "zh-tw": "分享", en: "Share", ja: "共有", ko: "공유" },
  "simulation.badge": { "zh-tw": "分享", en: "SHARE", ja: "共有", ko: "공유" },
  "simulation.shareTitle": { "zh-tw": "分享配置", en: "Share build", ja: "ビルドを共有", ko: "빌드 공유" },
  "simulation.shareOpen": { "zh-tw": "展開分享面板", en: "Open share panel", ja: "共有パネルを開く", ko: "공유 패널 열기" },
  "simulation.shareClose": { "zh-tw": "關閉分享面板", en: "Close share panel", ja: "共有パネルを閉じる", ko: "공유 패널 닫기" },
  "simulation.copy": { "zh-tw": "複製", en: "Copy", ja: "コピー", ko: "복사" },
  "simulation.imageLoading": { "zh-tw": "正在生成圖片…", en: "Generating image…", ja: "画像を生成中…", ko: "이미지를 생성하는 중…" },
  "simulation.imageAlt": { "zh-tw": "模擬配點圖片預覽", en: "Build simulation image preview", ja: "ビルドシミュレーション画像のプレビュー", ko: "빌드 시뮬레이션 이미지 미리보기" },
  "simulation.download": { "zh-tw": "下載圖片", en: "Download image", ja: "画像をダウンロード", ko: "이미지 다운로드" },
  "simulation.teamOptional": { "zh-tw": "隊伍設定 (可選)", en: "Team setup (optional)", ja: "チーム設定（任意）", ko: "팀 설정 (선택)" },
  "simulation.teamHint": { "zh-tw": "點擊任意格子編輯", en: "Click any slot to edit", ja: "スロットをクリックして編集", ko: "슬롯을 클릭해 편집" },
  "simulation.team": { "zh-tw": "隊伍 {team}", en: "Team {team}", ja: "チーム {team}", ko: "팀 {team}" },
  "simulation.pickerTitle": { "zh-tw": "選擇隊伍骰子", en: "Choose team dice", ja: "チームのダイスを選択", ko: "팀 주사위 선택" },
  "simulation.pickerCount": { "zh-tw": "已選擇 {count}/5", en: "Selected {count}/5", ja: "選択済み {count}/5", ko: "선택 {count}/5" },
  "simulation.pickerBack": { "zh-tw": "返回分享配置", en: "Back to share build", ja: "共有ビルドに戻る", ko: "공유 빌드로 돌아가기" },
  "simulation.saveTeam": { "zh-tw": "儲存隊伍", en: "Save team", ja: "チームを保存", ko: "팀 저장" },
  "simulation.emptySlot": { "zh-tw": "空槽位 {slot}", en: "Empty slot {slot}", ja: "空きスロット {slot}", ko: "빈 슬롯 {slot}" },
  "changelog.empty": { "zh-tw": "目前沒有可呈現的版本更新。", en: "No version updates are available.", ja: "表示できる更新履歴はありません。", ko: "표시할 버전 업데이트가 없습니다." },
  "changelog.datePending": { "zh-tw": "日期待確認", en: "Date pending", ja: "日付未確認", ko: "날짜 확인 중" },
  "changelog.added": { "zh-tw": "新增", en: "Added", ja: "追加", ko: "추가" },
  "changelog.modified": { "zh-tw": "修改", en: "Modified", ja: "変更", ko: "수정" },
  "changelog.removed": { "zh-tw": "移除", en: "Removed", ja: "削除", ko: "삭제" },
  "changelog.schema": { "zh-tw": "資料結構變更", en: "Schema changes", ja: "データ構造の変更", ko: "스키마 변경" },
  "changelog.important": { "zh-tw": "重要數值變更", en: "Important value changes", ja: "重要な数値の変更", ko: "중요 수치 변경" },
  "changelog.1.0.0.1": { "zh-tw": "建立初始版本資料快照，涵蓋五大陣營的 239 個天賦節點與圖鑑。", en: "Created the initial data snapshot with 239 talent nodes across five factions and the compendium.", ja: "5つの勢力にまたがる239個の才能ノードと図鑑を含む初期データスナップショットを作成しました。", ko: "5개 진영의 239개 특성 노드와 도감을 포함한 초기 데이터 스냅샷을 만들었습니다." },
  "changelog.1.0.2.1": { "zh-tw": "調整部分高階節點的升級金幣與核心需求。", en: "Adjusted gold and core costs for several high-tier nodes.", ja: "一部の高位ノードのゴールドとコアのコストを調整しました。", ko: "일부 고급 노드의 골드와 코어 비용을 조정했습니다." },
  "changelog.1.0.2.2": { "zh-tw": "新增商店彈窗與違規提示等文字在地化內容。", en: "Added localization content for shop dialogs and violation notices.", ja: "ショップダイアログや違反通知などのローカライズ内容を追加しました。", ko: "상점 대화상자와 위반 알림 등의 현지화 내용을 추가했습니다." },
  "changelog.1.0.3.1": { "zh-tw": "同步 1.0.3 版本資料，更新 239 個節點的數值與文案。", en: "Synced version 1.0.3 data, including values and text for all 239 nodes.", ja: "1.0.3のデータを同期し、239個のノードの数値とテキストを更新しました。", ko: "1.0.3 데이터를 동기화하고 239개 노드의 수치와 텍스트를 업데이트했습니다." },
  "changelog.1.0.3.2": { "zh-tw": "支援波次戰術事件分支與 SP 魔像數值試算。", en: "Added wave tactic branches and SP Golem value calculations.", ja: "ウェーブ戦術イベントの分岐とSPゴーレムの数値計算に対応しました。", ko: "웨이브 전술 이벤트 분기와 SP 골렘 수치 계산을 지원합니다." },
  "notice.officialPrefix": { "zh-tw": "官方公告：", en: "Official notice: ", ja: "公式告知：", ko: "공식 공지: " },
  "stats.damage": { "zh-tw": "傷害", en: "Damage", ja: "ダメージ", ko: "피해" },
  "stats.attack": { "zh-tw": "攻擊力", en: "Attack", ja: "攻撃力", ko: "공격력" },
  "stats.attackSpeed": { "zh-tw": "攻擊速度", en: "Attack speed", ja: "攻撃速度", ko: "공격 속도" },
  "stats.range": { "zh-tw": "攻擊範圍", en: "Range", ja: "攻撃範囲", ko: "공격 범위" },
  "stats.hp": { "zh-tw": "生命值", en: "HP", ja: "HP", ko: "생명력" },
  "stats.sp": { "zh-tw": "SP", en: "SP", ja: "SP", ko: "SP" },
  "stats.special": { "zh-tw": "特殊屬性", en: "Special stat", ja: "特殊ステータス", ko: "특수 능력치" },
  "stats.target": { "zh-tw": "目標", en: "Target", ja: "対象", ko: "대상" },
  "stats.spikeRange": { "zh-tw": "尖刺範圍", en: "Spike range", ja: "スパイク範囲", ko: "가시 범위" },
  "stats.relativeHp": { "zh-tw": "相對生命值", en: "Relative HP", ja: "相対HP", ko: "상대 생명력" },
  "stats.bossHp": { "zh-tw": "首領生命值比例", en: "Boss HP ratio", ja: "ボスHP比率", ko: "보스 생명력 비율" },
  "stats.moveSpeed": { "zh-tw": "移動速度", en: "Movement speed", ja: "移動速度", ko: "이동 속도" },
  "stats.golemHp": { "zh-tw": "魔像生命值", en: "Golem HP", ja: "ゴーレムHP", ko: "골렘 생명력" },
  "stats.spDropCoop": { "zh-tw": "SP掉落 (合作)", en: "SP drop (Co-op)", ja: "SPドロップ（協力）", ko: "SP 드롭 (협동)" },
  "stats.spDropVersus": { "zh-tw": "SP掉落 (競技)", en: "SP drop (Arena)", ja: "SPドロップ（アリーナ）", ko: "SP 드롭 (아레나)" },
  "simulation.coreSpent": { "zh-tw": "本次模擬消耗核心", en: "Cores spent in this simulation", ja: "このシミュレーションで消費したコア", ko: "이번 시뮬레이션에서 사용한 코어" },
  "simulation.goldSpent": { "zh-tw": "本次模擬消耗金幣", en: "Gold spent in this simulation", ja: "このシミュレーションで消費したゴールド", ko: "이번 시뮬레이션에서 사용한 골드" },
  "stats.max": { "zh-tw": "最大", en: "Max", ja: "最大", ko: "최대" },
  "stats.rankSlider": { "zh-tw": "階級滑桿", en: "Rank slider", ja: "ランクスライダー", ko: "등급 슬라이더" },
  "stats.adjustRank": { "zh-tw": "調整 {name} 階級", en: "Adjust {name} rank", ja: "{name}のランクを調整", ko: "{name} 등급 조정" },
  "stats.empty": { "zh-tw": "尚未配置任何被動能力節點", en: "No passive nodes are allocated yet", ja: "パッシブノードはまだ割り当てられていません", ko: "아직 할당된 패시브 노드가 없습니다" },
  "common.loading": { "zh-tw": "載入中…", en: "Loading…", ja: "読み込み中…", ko: "로드 중…" },
  "common.closeHint": { "zh-tw": "關閉", en: "Close", ja: "閉じる", ko: "닫기" },
  "common.view": { "zh-tw": "查看", en: "View", ja: "表示", ko: "보기" },
  "search.type": { "zh-tw": "類型", en: "Type", ja: "種類", ko: "유형" },
  "search.resultDetails": { "zh-tw": "查看 {name} 詳細資訊", en: "View details for {name}", ja: "{name}の詳細を表示", ko: "{name} 상세 보기" },
  "simulation.modeOn": { "zh-tw": "結束模擬配點模式", en: "Exit build simulation mode", ja: "ビルドシミュレーションを終了", ko: "빌드 시뮬레이션 종료" },
  "simulation.modeOff": { "zh-tw": "開啟模擬配點模式", en: "Open build simulation mode", ja: "ビルドシミュレーションを開く", ko: "빌드 시뮬레이션 열기" },
  "simulation.modeOnLabel": { "zh-tw": "結束模擬", en: "Exit simulation", ja: "シミュレーションを終了", ko: "시뮬레이션 종료" },
  "simulation.modeOffLabel": { "zh-tw": "模擬配點", en: "Build simulation", ja: "ビルドシミュレーション", ko: "빌드 시뮬레이션" },
  "simulation.exitBadge": { "zh-tw": "模擬", en: "SIMULATION", ja: "シミュレーション", ko: "시뮬레이션" },
  "simulation.exitTitle": { "zh-tw": "結束模擬", en: "Exit simulation", ja: "シミュレーションを終了", ko: "시뮬레이션 종료" },
  "simulation.exitDescription": { "zh-tw": "選擇如何處理目前的模擬配點。", en: "Choose what to do with this simulation.", ja: "現在のシミュレーションをどうするか選択してください。", ko: "현재 시뮬레이션을 어떻게 처리할지 선택하세요." },
  "simulation.resetAndExit": { "zh-tw": "重置並離開", en: "Reset and exit", ja: "リセットして終了", ko: "초기화하고 나가기" },
  "simulation.pause": { "zh-tw": "暫離", en: "Leave temporarily", ja: "一時退出", ko: "임시로 나가기" },
  "simulation.exitClose": { "zh-tw": "關閉結束模擬面板", en: "Close exit simulation panel", ja: "終了パネルを閉じる", ko: "종료 패널 닫기" },
  "simulation.slotEdit": { "zh-tw": "隊伍 {team}：{name}，點擊編輯", en: "Team {team}: {name}; click to edit", ja: "チーム{team}：{name}。クリックして編集", ko: "팀 {team}: {name}; 클릭해 편집" },
  "simulation.slotEmpty": { "zh-tw": "隊伍 {team}：空槽位 {slot}，點擊編輯", en: "Team {team}: empty slot {slot}; click to edit", ja: "チーム{team}：空きスロット{slot}。クリックして編集", ko: "팀 {team}: 빈 슬롯 {slot}; 클릭해 편집" },
  "simulation.position": { "zh-tw": "位置 {slot}", en: "Slot {slot}", ja: "位置 {slot}", ko: "슬롯 {slot}" },
  "simulation.imageError": { "zh-tw": "圖片生成失敗", en: "Image generation failed", ja: "画像の生成に失敗しました", ko: "이미지 생성 실패" },
  "simulation.urlLoading": { "zh-tw": "產生短網址中…", en: "Creating short link…", ja: "短縮リンクを作成中…", ko: "짧은 링크 생성 중…" },
  "simulation.copySuccess": { "zh-tw": "已複製", en: "Copied", ja: "コピーしました", ko: "복사됨" },
  "simulation.copyManual": { "zh-tw": "請手動複製", en: "Copy manually", ja: "手動でコピーしてください", ko: "직접 복사해 주세요" },
  "simulation.imageGenerating": { "zh-tw": "產生中…", en: "Generating…", ja: "生成中…", ko: "생성 중…" },
  "simulation.imageDownloaded": { "zh-tw": "已下載", en: "Downloaded", ja: "ダウンロード済み", ko: "다운로드됨" },
  "simulation.pickerBadge": { "zh-tw": "隊伍 {team}", en: "TEAM {team}", ja: "チーム {team}", ko: "팀 {team}" },
  "simulation.selectedOrder": { "zh-tw": "第 {order} 順位", en: "Position {order}", ja: "{order}番目", ko: "{order}번째" },
  "simulation.diceFallback": { "zh-tw": "骰子", en: "Dice", ja: "ダイス", ko: "주사위" },
  "simulation.shareImageFilename": { "zh-tw": "random-dice-2-lab-planning.png", en: "random-dice-2-lab-planning.png", ja: "random-dice-2-lab-planning.png", ko: "random-dice-2-lab-planning.png" },
  "simulation.imageTitle": { "zh-tw": "骰子樹模擬配點", en: "Dice tree build simulation", ja: "ダイスツリーのビルドシミュレーション", ko: "주사위 트리 빌드 시뮬레이션" },
  "simulation.goldLabel": { "zh-tw": "金幣", en: "Gold", ja: "ゴールド", ko: "골드" },
  "simulation.coreLabel": { "zh-tw": "核心", en: "Cores", ja: "コア", ko: "코어" },
  "simulation.watermark": { "zh-tw": "Random Dice 2 Lab", en: "Random Dice 2 Lab", ja: "Random Dice 2 Lab", ko: "Random Dice 2 Lab" },
  "simulation.specialUnlock": { "zh-tw": "特殊解鎖條件", en: "Special unlock condition", ja: "特殊解放条件", ko: "특수 해금 조건" },
  "simulation.cancelToHere": { "zh-tw": "取消至此", en: "Revoke to here", ja: "ここまで取り消す", ko: "여기까지 취소" },
  "simulation.cancelUnlock": { "zh-tw": "取消解鎖", en: "Revoke unlock", ja: "解放を取り消す", ko: "해금 취소" },
  "simulation.cannotUnlock": { "zh-tw": "無法解鎖", en: "Cannot unlock", ja: "解放できません", ko: "해금할 수 없음" },
  "simulation.unlockPath": { "zh-tw": "解鎖途徑", en: "Unlock path", ja: "解放経路", ko: "해금 경로" },
  "simulation.unlockToHere": { "zh-tw": "解鎖至此", en: "Unlock to here", ja: "ここまで解放", ko: "여기까지 해금" },
  "simulation.unlockCost": { "zh-tw": "解鎖消耗", en: "Unlock cost", ja: "解放コスト", ko: "해금 비용" },
  "simulation.upgradeCost": { "zh-tw": "升階消耗", en: "Upgrade cost", ja: "ランクアップコスト", ko: "승급 비용" },
  "simulation.rankAdjust": { "zh-tw": "階級調整", en: "Rank adjustment", ja: "ランク調整", ko: "등급 조정" },
  "simulation.unlockRankAdjust": { "zh-tw": "調整解鎖等級", en: "Adjust unlock rank", ja: "解放ランクを調整", ko: "해금 등급 조정" },
  "simulation.rankDisplay": { "zh-tw": "第 {rank} / {max} 階", en: "Rank {rank} / {max}", ja: "ランク {rank} / {max}", ko: "등급 {rank} / {max}" },
  "simulation.previewRank": { "zh-tw": "調整階級預覽", en: "Adjust rank preview", ja: "ランクプレビューを調整", ko: "등급 미리보기 조정" },
  "simulation.totalCost": { "zh-tw": "累計消耗", en: "Total cost", ja: "累計コスト", ko: "총 비용" },
  "compendium.countDice": { "zh-tw": "{count} 顆骰子", en: "{count} dice", ja: "ダイス {count}個", ko: "주사위 {count}개" },
  "compendium.countMonsters": { "zh-tw": "{count} 隻怪物", en: "{count} monsters", ja: "モンスター {count}体", ko: "몬스터 {count}마리" },
  "compendium.countEvents": { "zh-tw": "{count} 個事件", en: "{count} events", ja: "イベント {count}件", ko: "이벤트 {count}개" },
  "compendium.faction": { "zh-tw": "{name}陣營", en: "{name} faction", ja: "{name}勢力", ko: "{name} 진영" },
  "compendium.factionCount": { "zh-tw": "{count} 顆骰子", en: "{count} dice", ja: "ダイス {count}個", ko: "주사위 {count}개" },
  "compendium.monsterGroup.normal": { "zh-tw": "一般與特殊怪物", en: "Normal and special monsters", ja: "通常・特殊モンスター", ko: "일반 및 특수 몬스터" },
  "compendium.monsterGroup.boss": { "zh-tw": "首領怪物 (BOSS)", en: "Boss monsters (BOSS)", ja: "ボスモンスター (BOSS)", ko: "보스 몬스터 (BOSS)" },
  "compendium.phase.early": { "zh-tw": "前期事件", en: "Early events", ja: "序盤イベント", ko: "초반 이벤트" },
  "compendium.phase.mid": { "zh-tw": "中期事件", en: "Mid events", ja: "中盤イベント", ko: "중반 이벤트" },
  "compendium.phase.late": { "zh-tw": "後期事件", en: "Late events", ja: "終盤イベント", ko: "후반 이벤트" },
  "compendium.historyTitle": { "zh-tw": "歷史事件・已移除", en: "Historical events · removed", ja: "過去のイベント・削除済み", ko: "지난 이벤트 · 삭제됨" },
  "compendium.historyNote": { "zh-tw": "保留名稱與快照資料供舊網址查閱，不列入目前版本統計。", en: "Names and snapshots are retained for reference and excluded from the current-version count.", ja: "名前とスナップショットを参照用に保存し、現行バージョンの集計から除外しています。", ko: "이름과 스냅샷은 참고용으로 보존하며 현재 버전 집계에서 제외합니다." },
  "compendium.details": { "zh-tw": "查看 {name} 詳細資訊", en: "View details for {name}", ja: "{name}の詳細を表示", ko: "{name} 상세 보기" },
  "compendium.locate": { "zh-tw": "在地圖中定位", en: "Locate on map", ja: "マップで位置を表示", ko: "지도에서 위치 찾기" },
  "compendium.locateNamed": { "zh-tw": "在地圖中定位 {name}", en: "Locate {name} on the map", ja: "{name}をマップで表示", ko: "지도에서 {name} 위치 찾기" },
  "compendium.specialEffects": { "zh-tw": "專屬效果", en: "Exclusive effects", ja: "固有効果", ko: "고유 효과" },
  "compendium.adjustLevel": { "zh-tw": "點擊調整等級", en: "Click to adjust level", ja: "クリックしてレベルを調整", ko: "클릭해 레벨 조정" },
  "compendium.adjustRune": { "zh-tw": "調整 {name} 等級", en: "Adjust {name} level", ja: "{name}のレベルを調整", ko: "{name} 레벨 조정" },
  "compendium.rankSlider": { "zh-tw": "等級滑桿", en: "Level slider", ja: "レベルスライダー", ko: "레벨 슬라이더" },
  "compendium.removedView": { "zh-tw": "查看已移除", en: "View removed", ja: "削除済みを表示", ko: "삭제된 항목 보기" },
  "compendium.eventDetails": { "zh-tw": "{prefix} {name} 事件詳情", en: "{prefix} {name} event details", ja: "{prefix}{name}イベントの詳細", ko: "{prefix} {name} 이벤트 상세" },
  "compendium.removedBadge": { "zh-tw": "已移除", en: "Removed", ja: "削除済み", ko: "삭제됨" },
  "compendium.removedStatus": { "zh-tw": "已移除｜最後存在版本 {last}；移除版本 {removed}", en: "Removed · last seen in {last}; removed in {removed}", ja: "削除済み｜最終確認 {last}、削除 {removed}", ko: "삭제됨 · 마지막 확인 {last}; 삭제 버전 {removed}" },
  "compendium.modeCoop": { "zh-tw": "合作", en: "Co-op", ja: "協力", ko: "협동" },
  "compendium.modeVersus": { "zh-tw": "競技", en: "Arena", ja: "アリーナ", ko: "아레나" },
  "compendium.eventChoiceAlt": { "zh-tw": "{name}", en: "{name}", ja: "{name}", ko: "{name}" },
  "changelog.versionAria": { "zh-tw": "目前遊戲資料版本 {version}", en: "Current game data version {version}", ja: "現在のゲームデータバージョン {version}", ko: "현재 게임 데이터 버전 {version}" },
  "changelog.versionUpdate": { "zh-tw": "更新遊戲資料至版本 v{version}", en: "Updated game data to version v{version}", ja: "ゲームデータをv{version}に更新", ko: "게임 데이터를 v{version}으로 업데이트" },
  "changelog.noticeTitle": { "zh-tw": "官方公告：{title}", en: "Official notice: {title}", ja: "公式告知：{title}", ko: "공식 공지: {title}" },
  "changelog.officialPrefix": { "zh-tw": "官方公告：", en: "Official notice: ", ja: "公式告知：", ko: "공식 공지: " },
  "changelog.unknownVersion": { "zh-tw": "未知", en: "Unknown", ja: "不明", ko: "알 수 없음" },
  "loader.boot": { "zh-tw": "正在啟動…", en: "Starting…", ja: "起動中…", ko: "시작 중…" },
  "app.errorTitle": { "zh-tw": "資料載入失敗", en: "Data loading failed", ja: "データの読み込みに失敗しました", ko: "데이터 로드 실패" },
  "app.errorMessage": { "zh-tw": "無法載入網站資料，請重新載入頁面。", en: "The site data could not be loaded. Reload the page to try again.", ja: "サイトデータを読み込めませんでした。ページを再読み込みしてください。", ko: "사이트 데이터를 불러오지 못했습니다. 페이지를 다시 로드해 주세요." },
  "monster.normal.name": { "zh-tw": "一般怪物", en: "Normal Monster", ja: "通常モンスター", ko: "일반 몬스터" },
  "monster.normal.desc": { "zh-tw": "最基本的怪物", en: "The most common monster", ja: "最も基本的なモンスター", ko: "가장 기본적인 몬스터" },
  "monster.speed.name": { "zh-tw": "快速怪物", en: "Speed Monster", ja: "高速モンスター", ko: "빠른 몬스터" },
  "monster.speed.desc": { "zh-tw": "速度極快的怪物", en: "A fast-moving monster", ja: "非常に速いモンスター", ko: "매우 빠른 몬스터" },
  "monster.big.name": { "zh-tw": "大型怪物", en: "Big Monster", ja: "大型モンスター", ko: "대형 몬스터" },
  "monster.big.desc": { "zh-tw": "持有大量生命值的大型怪物", en: "A large monster with high HP", ja: "高いHPを持つ大型モンスター", ko: "생명력이 높은 대형 몬스터" },
  "monster.box.name": { "zh-tw": "SP怪物", en: "SP Monster", ja: "SPモンスター", ko: "SP 몬스터" },
  "monster.box.desc": { "zh-tw": "裝滿 SP 的怪異生物；擊殺時可獲得更多 SP", en: "A strange creature filled with SP; grants more SP when defeated", ja: "SPが詰まった奇妙な生物。倒すと多くのSPを獲得できます", ko: "SP가 가득한 기묘한 생물이며 처치하면 더 많은 SP를 얻습니다" },
  "monster.golem.name": { "zh-tw": "SP魔像", en: "SP Golem", ja: "SPゴーレム", ko: "SP 골렘" },
  "monster.golem.desc": { "zh-tw": "持有大量 SP 的怪物，擊殺後可獲得 SP", en: "A monster carrying a large amount of SP. Defeat it to claim the SP.", ja: "大量のSPを持つモンスター。倒すとSPを獲得できます", ko: "많은 SP를 지닌 몬스터이며 처치하면 SP를 얻습니다" },
  "monster.subtype.normal": { "zh-tw": "普通怪物", en: "Normal monster", ja: "通常モンスター", ko: "일반 몬스터" },
  "monster.subtype.speed": { "zh-tw": "快速怪物", en: "Speed monster", ja: "高速モンスター", ko: "빠른 몬스터" },
  "monster.subtype.big": { "zh-tw": "大型怪物", en: "Big monster", ja: "大型モンスター", ko: "대형 몬스터" },
  "monster.subtype.boss": { "zh-tw": "首領怪物", en: "Boss", ja: "ボス", ko: "보스" },
  "monster.subtype.box": { "zh-tw": "SP怪物", en: "SP monster", ja: "SPモンスター", ko: "SP 몬스터" },
  "monster.subtype.hunt": { "zh-tw": "首領怪物", en: "Boss", ja: "ボス", ko: "보스" },
  "monster.modeDataFallback": { "zh-tw": "依模式資料", en: "Mode-specific data", ja: "モード別データ", ko: "모드별 데이터" },
  "monster.golemHpRange": { "zh-tw": "50–100%", en: "50–100%", ja: "50–100%", ko: "50–100%" },
  "event.phase.early": { "zh-tw": "前期", en: "Early", ja: "序盤", ko: "초반" },
  "event.phase.mid": { "zh-tw": "中期", en: "Mid", ja: "中盤", ko: "중반" },
  "event.phase.late": { "zh-tw": "後期", en: "Late", ja: "終盤", ko: "후반" },
  "event.fallback": { "zh-tw": "戰術事件效果", en: "Tactic effect", ja: "戦術イベント効果", ko: "전술 이벤트 효과" },
  "event.choose": { "zh-tw": "選擇由我決定", en: "Choose for me", ja: "自分で選択", ko: "직접 선택" },
  "event.removed": { "zh-tw": "已移除", en: "Removed", ja: "削除済み", ko: "삭제됨" },
  "event.mode": { "zh-tw": "模式", en: "Mode", ja: "モード", ko: "모드" },
  "event.mode.coop": { "zh-tw": "合作", en: "Co-op", ja: "協力", ko: "협동" },
  "event.mode.versus": { "zh-tw": "競技場", en: "Arena", ja: "アリーナ", ko: "아레나" },
  "event.duration.instant": { "zh-tw": "立即生效", en: "Immediate", ja: "即時", ko: "즉시 적용" },
  "event.duration.passive": { "zh-tw": "永久", en: "Permanent", ja: "永続", ko: "영구" },
  "event.duration.single": { "zh-tw": "觸發 1 次", en: "Triggers once", ja: "1回発動", ko: "1회 발동" },
  "faction.1": { "zh-tw": "自然", en: "Nature", ja: "自然", ko: "자연" },
  "faction.2": { "zh-tw": "工學", en: "Engineering", ja: "工学", ko: "공학" },
  "faction.3": { "zh-tw": "魔法", en: "Magic", ja: "魔法", ko: "마법" },
  "faction.4": { "zh-tw": "秩序", en: "Order", ja: "秩序", ko: "질서" },
  "faction.5": { "zh-tw": "渾沌", en: "Chaos", ja: "カオス", ko: "혼돈" },
};

function addCustomText(ui, key, zh, translations = {}) {
  if (!ui[key]) {
    ui[key] = {
      "zh-tw": zh,
      en: translations.en || zh,
      ja: translations.ja || zh,
      ko: translations.ko || zh
    };
  }
  return key;
}

function sourceKeyByValue(reverse, value, preferred = []) {
  const exact = reverse.get(String(value || "").trim());
  if (!exact || exact.length === 0) return null;
  for (const prefix of preferred) {
    const candidate = exact.find((key) => key.startsWith(prefix));
    if (candidate) return candidate;
  }
  return exact[0];
}

function sourceEntry(sourceMap, key) {
  return key ? sourceMap.get(key) || null : null;
}

const SPECIAL_STAT_KEYS = {
  "尖刺範圍": "stats.spikeRange",
  "相對生命值": "stats.relativeHp",
  "Boss HP 比例": "stats.bossHp",
  "移動速度": "stats.moveSpeed",
  "魔像生命值": "stats.golemHp",
  "SP掉落 (合作)": "stats.spDropCoop",
  "SP掉落 (競技)": "stats.spDropVersus"
};

function resolveUnlockMapping(node) {
  const condition = String(node?.unlock_condition ?? node?.special_unlock ?? node?.unlock_condition_special ?? "").trim();
  const generatedKey = String(node?.unlock_condition_key || "").trim();
  if (generatedKey) {
    return {
      key: generatedKey,
      value: String(node?.unlock_condition_value || "").trim()
    };
  }
  const legacyKey = LEGACY_UNLOCK_KEYS[condition] || "";
  if (legacyKey) return { key: legacyKey, value: String(node?.unlock_condition_value || "").trim() };

  if (condition.startsWith("LV_")) {
    const key = `unlock.${condition.slice(3).toLowerCase()}`;
    return {
      key: UI[key] ? key : "unlock.prerequisite",
      value: String(node?.unlock_condition_value || "").trim()
    };
  }

  const label = String(node?.unlock_condition_zh || "").trim();
  const levelByLabel = {
    "自然等級": "unlock.nature",
    "工程等級": "unlock.engineering",
    "工學等級": "unlock.engineering",
    "魔法等級": "unlock.magic",
    "秩序等級": "unlock.guardian",
    "渾沌等級": "unlock.invader"
  };
  if (levelByLabel[label]) {
    return {
      key: levelByLabel[label],
      value: String(node?.unlock_condition_value || "").trim()
    };
  }

  return { key: "unlock.prerequisite", value: "" };
}

function addRequiredSource(source, sourceMap, key, requiredKeys) {
  if (!key) return false;
  const entry = sourceEntry(sourceMap, key);
  if (!entry || !completeEntry(entry)) return false;
  source[key] = entry;
  requiredKeys.add(key);
  return true;
}

function findNodeSourceRow(node, rows) {
  if (node.node_type === "DICE") return rows.defender.find((candidate) => candidate.DefenderType === node.dice_type);
  if (node.node_type === "DICE_RUNE") return rows.rune.find((candidate) => candidate.Kind === node.rune_kind && (!node.rune_dice || candidate.DefenderType === node.rune_dice));
  if (node.node_type === "PLAYER_PASSIVE") return rows.passive.find((candidate) => candidate.StringId === node.passive_id);
  if (node.node_type === "PERK") return rows.perk.find((candidate) => candidate.PerkActionType === node.perk_type);
  return null;
}

function sourceFieldValue(node, field) {
  return field === "description" ? node.description_zh : node.name_zh;
}

function addNodeFieldMapping({ mapping, field, row, reverse, node, source, sourceMap, requiredKeys }) {
  const columns = {
    name: ["Local_Name", ["dice_", "perk_", "tag_"]],
    description: ["Local_Desc", ["dice_", "perk_", "tag_"]],
    fullName: ["Local_FullName", ["dice_"]]
  };
  const [column, preferred] = columns[field];
  const key = row?.[column] || sourceKeyByValue(reverse, sourceFieldValue(node, field), preferred);
  if (addRequiredSource(source, sourceMap, key, requiredKeys)) mapping[field] = key;
}

function addNodeSpecialStat(stat, node, reverse, source, sourceMap, requiredKeys) {
  const stableKey = String(stat?.label_key || stat?.stat_key || "").trim();
  if (stableKey) {
    if (UI[stableKey]) return stableKey;
    if (!addRequiredSource(source, sourceMap, stableKey, requiredKeys)) {
      throw new Error(`special stat ${node.id}/${stat.stat_id || stableKey} does not have a complete four-locale source row`);
    }
    return stableKey;
  }
  if (node.node_type === "DICE") {
    throw new Error(`generated DICE stat ${node.id}/${stat.stat_id || "unknown"} is missing a stable label_key`);
  }
  const found = sourceKeyByValue(reverse, stat.label, ["stat_", "dice_"]);
  if (addRequiredSource(source, sourceMap, found, requiredKeys)) return found;
  const customKey = SPECIAL_STAT_KEYS[String(stat.label || "").trim()] || `stat.${slug(stat.label)}`;
  return addCustomText(UI, customKey, stat.label, {
    en: stat.label,
    ja: stat.label,
    ko: stat.label
  });
}

function buildNodeLocalizationMapping(node, rows, reverse, source, sourceMap, requiredKeys) {
  const mapping = {};
  const row = findNodeSourceRow(node, rows);
  for (const field of ["name", "description", "fullName"]) {
    addNodeFieldMapping({ mapping, field, row, reverse, node, source, sourceMap, requiredKeys });
  }
  const awakening = sourceKeyByValue(reverse, node.dice_awaken, ["dice_", "skill_"]);
  if (addRequiredSource(source, sourceMap, awakening, requiredKeys)) mapping.awakening = awakening;
  const branchGroup = node.dice_group || node.passive_group || node.perk_group
    || ({ 1: "Nature", 2: "Engineering", 3: "Magic", 4: "Guardian", 5: "Invader" }[String(node.branch)] || "");
  const factionKey = `dicegroup_${String(branchGroup).toLowerCase()}`;
  if (addRequiredSource(source, sourceMap, factionKey, requiredKeys)) mapping.branch = factionKey;
  const targetKey = sourceKeyByValue(reverse, node.dice_target_zh, ["target_"]);
  if (addRequiredSource(source, sourceMap, targetKey, requiredKeys)) mapping.target = targetKey;
  const nodeTypeKeys = { DICE: "node.type.dice", DICE_RUNE: "node.type.dice_rune", PLAYER_PASSIVE: "node.type.passive", PERK: "node.type.perk" };
  mapping.nodeType = nodeTypeKeys[node.node_type];
  const unlock = resolveUnlockMapping(node);
  mapping.unlockCondition = unlock.key;
  if (unlock.value) mapping.unlockConditionValue = unlock.value;
  if (Array.isArray(node.special_stats)) {
    mapping.specialStats = node.special_stats.map((stat) => addNodeSpecialStat(stat, node, reverse, source, sourceMap, requiredKeys));
  }
  return mapping;
}

function buildAugmentChoiceMapping(choice, source, sourceMap, requiredKeys) {
  const key = String(choice.key || "").trim();
  const name = key ? `augment_${key}_title` : null;
  const description = key ? `augment_${key}_desc` : null;
  const result = {};
  if (addRequiredSource(source, sourceMap, name, requiredKeys)) result.name = name;
  if (addRequiredSource(source, sourceMap, description, requiredKeys)) result.description = description;
  return result;
}

function buildEventLocalizationMapping(event, rows, reverse, source, sourceMap, requiredKeys) {
  const row = rows.get(event.eventKind);
  const overrideKey = { FieldDiceCountSPUp: "FieldDiceCountDamageUp" }[event.eventKind];
  const nameKey = row?.Local_Name || sourceKeyByValue(reverse, event.name_zh, ["tactics_name_"]);
  const descriptionKey = row?.Local_Desc || sourceKeyByValue(reverse, event.desc_zh, ["tactics_desc_"]);
  const resolvedNameKey = overrideKey ? `tactics_name_${overrideKey}` : nameKey;
  const resolvedDescriptionKey = overrideKey ? `tactics_desc_${overrideKey}` : descriptionKey;
  const mapping = {};
  if (addRequiredSource(source, sourceMap, resolvedNameKey, requiredKeys)) mapping.name = resolvedNameKey;
  if (addRequiredSource(source, sourceMap, resolvedDescriptionKey, requiredKeys)) mapping.description = resolvedDescriptionKey;
  const phaseKey = `event.phase.${String(event.phase || "").toLowerCase()}`;
  if (UI[phaseKey]) mapping.phase = phaseKey;
  if (Array.isArray(event.augment_choices)) {
    mapping.choices = event.augment_choices.map((choice) => buildAugmentChoiceMapping(choice, source, sourceMap, requiredKeys));
  }
  return mapping;
}

function buildMonsterLocalizationMapping(monster, rows, genericMonsterKeys, source, sourceMap, requiredKeys) {
  const mapping = {};
  const bossRow = rows.find((row) => row.BossType && row.BossType === monster.bossType);
  const generic = genericMonsterKeys[monster.id];
  const nameKey = generic?.[0] || bossRow?.Local_Name;
  const descriptionKey = generic?.[1] || bossRow?.Local_Desc;
  const subtypeKey = generic?.[2] || "monster.subtype.boss";
  if (nameKey && (UI[nameKey] || addRequiredSource(source, sourceMap, nameKey, requiredKeys))) mapping.name = nameKey;
  if (descriptionKey && (UI[descriptionKey] || addRequiredSource(source, sourceMap, descriptionKey, requiredKeys))) mapping.description = descriptionKey;
  if (UI[subtypeKey]) mapping.subType = subtypeKey;
  return mapping;
}

function readSourceMap(sourceDir) {
  const sourceRows = fs.existsSync(path.join(sourceDir, "localization_text.csv"))
    ? parseCsv(fs.readFileSync(path.join(sourceDir, "localization_text.csv"), "utf8"))
    : [];
  const headerIndex = sourceRows.findIndex((row) => row.includes("ko") && row.includes("en") && row.includes("ja") && row.includes("zh-tw"));
  if (headerIndex < 0) throw new Error("localization_text.csv is missing its locale header");
  const header = sourceRows[headerIndex];
  const index = Object.fromEntries(locales.map((locale) => [locale, header.indexOf(locale)]));
  const sourceMap = new Map();
  const incomplete = [];
  for (const row of sourceRows.slice(headerIndex + 1)) {
    const key = String(row[0] || "").trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) continue;
    const entry = Object.fromEntries(locales.map((locale) => [locale, String(row[index[locale]] || "").trim()]));
    if (SOURCE_FORMAT_PATCHES[key]) Object.assign(entry, SOURCE_FORMAT_PATCHES[key]);
    sourceMap.set(key, entry);
    if (!completeEntry(entry)) incomplete.push(key);
  }
  const missingFormatPatches = Object.keys(SOURCE_FORMAT_PATCHES).filter((key) => !sourceMap.has(key));
  if (missingFormatPatches.length > 0) {
    throw new Error(`Source format patch keys are missing from localization_text.csv: ${missingFormatPatches.join(", ")}`);
  }
  return { sourceMap, incomplete };
}

function createReverseSourceMap(sourceMap) {
  const reverse = new Map();
  for (const [key, entry] of sourceMap) {
    const zh = entry["zh-tw"];
    if (!zh) continue;
    const values = reverse.get(zh) || [];
    values.push(key);
    reverse.set(zh, values);
  }
  return reverse;
}

function readSourceTableRows(sourceDir) {
  return {
    defender: readRows(sourceDir, "DefenderTable.csv", (row) => row.includes("DefenderType") && row.includes("Local_Name")),
    rune: readRows(sourceDir, "RuneTable.csv", (row) => row.includes("Kind") && row.includes("Local_Name") && row.includes("DefenderType")),
    passive: readRows(sourceDir, "PlayerPassiveTable.csv", (row) => row.includes("StringId") && row.includes("Local_Name")),
    perk: readRows(sourceDir, "PerkActionTable.csv", (row) => row.includes("PerkActionType") && row.includes("Local_Name")),
    tactic: readRows(sourceDir, "TacticsEffectTable.csv", (row) => row.includes("TacticsKind") && row.includes("Local_Name")),
    minion: readRows(sourceDir, "MinionTable.csv", (row) => row.includes("BossType") && row.includes("Local_Name"))
  };
}

const FACTION_NAMES = Object.freeze(["nature", "engineering", "magic", "guardian", "invader"]);

function addFactionMappings(source, sourceMap, requiredKeys, content) {
  FACTION_NAMES.forEach((faction, index) => {
    const key = `dicegroup_${faction}`;
    if (addRequiredSource(source, sourceMap, key, requiredKeys)) {
      content.factions[String(index + 1)] = key;
    }
  });
}

function addNodeMappings(treeData, rows, reverse, source, sourceMap, requiredKeys, content) {
  for (const node of treeData.nodes || []) {
    content.nodes[String(node.id)] = buildNodeLocalizationMapping(node, rows, reverse, source, sourceMap, requiredKeys);
  }
}

function addTagMappings(treeData, source, sourceMap, requiredKeys, content) {
  for (const [tagKey, definition] of Object.entries(treeData.tag_definitions || {})) {
    const nameKey = definition.name_key || `tag_name_${tagKey}`;
    const descriptionKey = definition.desc_key || `tag_desc_${tagKey}`;
    const hasName = addRequiredSource(source, sourceMap, nameKey, requiredKeys);
    const hasDescription = addRequiredSource(source, sourceMap, descriptionKey, requiredKeys);
    if (hasName && hasDescription) {
      content.tags[tagKey] = { name: nameKey, description: descriptionKey };
    }
  }
}

function addEventMappings(bossEvents, rows, reverse, source, sourceMap, requiredKeys, content) {
  const tacticByKind = new Map(rows.tactic.map((row) => [row.TacticsKind, row]));
  const events = [...(bossEvents.events || []), ...(bossEvents.historical_events || [])];
  for (const event of events) {
    content.events[String(event.id)] = buildEventLocalizationMapping(event, tacticByKind, reverse, source, sourceMap, requiredKeys);
  }
}

const GENERIC_MONSTER_KEYS = Object.freeze({
  monster_1: ["monster.normal.name", "monster.normal.desc", "monster.subtype.normal"],
  monster_2: ["monster.speed.name", "monster.speed.desc", "monster.subtype.speed"],
  monster_3: ["monster.big.name", "monster.big.desc", "monster.subtype.big"],
  monster_15: ["monster.box.name", "monster.box.desc", "monster.subtype.box"],
  monster_14: ["monster.golem.name", "monster.golem.desc", "monster.subtype.hunt"]
});

function addMonsterMappings(bossEvents, rows, source, sourceMap, requiredKeys, content) {
  for (const monster of bossEvents.monsters || []) {
    content.monsters[String(monster.id)] = buildMonsterLocalizationMapping(
      monster,
      rows.minion,
      GENERIC_MONSTER_KEYS,
      source,
      sourceMap,
      requiredKeys
    );
  }
}

function deriveSourceCatalog(sourceDir, treeData, bossEvents) {
  const { sourceMap, incomplete } = readSourceMap(sourceDir);
  const reverse = createReverseSourceMap(sourceMap);
  const source = {};
  const requiredKeys = new Set();
  const content = { nodes: {}, tags: {}, events: {}, monsters: {}, factions: {} };
  const rows = readSourceTableRows(sourceDir);
  addFactionMappings(source, sourceMap, requiredKeys, content);
  addNodeMappings(treeData, rows, reverse, source, sourceMap, requiredKeys, content);
  addTagMappings(treeData, source, sourceMap, requiredKeys, content);
  addEventMappings(bossEvents, rows, reverse, source, sourceMap, requiredKeys, content);
  addMonsterMappings(bossEvents, rows, source, sourceMap, requiredKeys, content);

  const incompleteKeys = incomplete.toSorted(compareStrings);
  const sourceFormatPatches = Object.keys(SOURCE_FORMAT_PATCHES).toSorted(compareStrings);
  const requiredSourceKeys = [...requiredKeys].toSorted(compareStrings);

  return {
    source,
    content,
    source_inventory: {
      total: sourceMap.size,
      complete: [...sourceMap.values()].filter(completeEntry).length,
      incomplete: incomplete.length,
      incomplete_keys: incompleteKeys
    },
    source_format_patches: sourceFormatPatches,
    required_source_keys: requiredSourceKeys
  };
}

function getSourceDir() {
  const argumentIndex = process.argv.indexOf("--source");
  const fromArgument = argumentIndex >= 0 ? process.argv[argumentIndex + 1] : "";
  const configured = fromArgument || process.env.RD2_SOURCE_TABLES || getDefaultSourceTablesPath();
  return path.resolve(configured);
}

const sourceDir = getSourceDir();
if (!fs.existsSync(path.join(sourceDir, "localization_text.csv"))) {
  console.error(`Missing localization source: ${path.join(sourceDir, "localization_text.csv")}`);
  process.exit(1);
}
const treeData = JSON.parse(fs.readFileSync(path.join(siteDir, "data", "dice_tree.json"), "utf8"));
const bossEvents = JSON.parse(fs.readFileSync(path.join(siteDir, "boss_event_data.json"), "utf8"));
const derived = deriveSourceCatalog(sourceDir, treeData, bossEvents);
const catalog = {
  schema_version: 1,
  source_version: "1.0.3",
  generated_from: "source locale rows and runtime entity stable IDs",
  default_locale: "zh-tw",
  locales,
  ui: UI,
  source: derived.source,
  content: derived.content,
  source_inventory: derived.source_inventory,
  source_format_patches: derived.source_format_patches,
  required_source_keys: derived.required_source_keys
};
fs.writeFileSync(localesPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`Locale catalog written to ${path.relative(rootDir, localesPath)} (${Object.keys(catalog.ui).length} UI keys, ${Object.keys(catalog.source).length} source keys, ${catalog.required_source_keys.length} runtime source keys).`);
console.log(`Source inventory: ${catalog.source_inventory.complete}/${catalog.source_inventory.total} complete; ${catalog.source_inventory.incomplete} incomplete source rows retained in the audit summary.`);
