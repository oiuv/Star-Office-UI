(() => {
  'use strict';
  const STATES = ['idle','writing','researching','executing','syncing','error'];
  // Group related events for display; this is not a strict event timeline.
  const HOOKS = [
    'UserPromptSubmit','PreToolUse','PermissionRequest','PostToolUse', // Shared with Codex: prompt and tools
    'SessionStart','SessionEnd','SubagentStart','SubagentStop', // Shared with Codex: sessions and subagents
    'PreCompact','PostCompact','Stop','Interrupt', // Shared with Codex (Interrupt is Codex-only)
    'Setup','InstructionsLoaded','ConfigChange', // Initialization and configuration
    'UserPromptExpansion','MessageDisplay','Notification', // Prompt input and messaging
    'PostToolBatch','PostToolUseFailure','PermissionDenied','StopFailure', // Execution feedback
    'Elicitation','ElicitationResult', // MCP interactions
    'TaskCreated','TaskCompleted','TeammateIdle', // Tasks and collaboration
    'FileChanged','CwdChanged','DirectoryAdded','WorktreeCreate','WorktreeRemove', // Workspace and file watching
    'PreModelSwitch','PostModelSwitch' // Model switching
  ];
  const CODEX_HOOKS = new Set(HOOKS.slice(0, 12));
  const HOOK_GROUPS = [
    {id:'session', title:'hookSessionGroup', hooks:['SessionStart','SessionEnd','UserPromptSubmit','UserPromptExpansion']},
    {id:'tools', title:'hookToolsGroup', hooks:['PreToolUse','PostToolUse','PostToolUseFailure','PostToolBatch']},
    {id:'permission', title:'hookPermissionGroup', hooks:['PermissionRequest','PermissionDenied','Elicitation','ElicitationResult']},
    {id:'finish', title:'hookFinish', hooks:['Stop','StopFailure','Interrupt']},
    {id:'team', title:'hookTeamGroup', note:'hookTeamNote', hooks:['SubagentStart','SubagentStop','TaskCreated','TaskCompleted','TeammateIdle']},
    {id:'context', title:'hookContextGroup', note:'hookContextNote', hooks:['PreCompact','PostCompact','PreModelSwitch','PostModelSwitch']},
    {id:'environment', title:'hookEnvironmentGroup', note:'hookEnvironmentNote', hooks:['Setup','InstructionsLoaded','WorktreeCreate','WorktreeRemove','ConfigChange','FileChanged','CwdChanged','DirectoryAdded']},
    {id:'messages', title:'hookMessagesGroup', note:'hookMessagesNote', hooks:['Notification','MessageDisplay']}
  ];
  const TEXT = {
    zh: {
      boardActivity:'Agent 留言板', boardOpen:'查看讨论 ↗', boardScope:'Codex 本地留言板 · 全部历史，不随上方日期筛选', boardMessages:'协作留言', boardTopics:'讨论主题', boardAgents:'参与 Agent', boardChannels:'频道',
      // Trigger semantics reviewed against the official Chinese Claude Code hooks reference.
      hookDescriptions:{
        SessionStart:"开始新会话或恢复会话时触发，也可由清空会话或上下文压缩后的恢复触发。",
        SessionEnd:"当前会话终止时触发；退出、清空或切换会话都可能结束当前会话。",
        UserPromptSubmit:"提示词提交后、Agent 处理前触发；Claude Code 的部分自动发起回合也会触发。",
        UserPromptExpansion:"用户输入的命令即将展开为提示词时触发，例如直接调用 /skillname。",
        PreToolUse:"工具调用执行之前触发，此时其他 hook 仍可修改、阻止或推迟调用。",
        PermissionRequest:"工具调用需要权限决策时触发；具体处理方式取决于权限模式与其他 hook。",
        PermissionDenied:"Claude Code 自动模式拒绝工具调用时触发，也包含未取得分类器判决的拒绝。",
        Elicitation:"MCP 服务器在工具调用期间请求用户信息时触发，可通过表单或验证页面交互。",
        ElicitationResult:"用户响应即将发回 MCP 服务器时触发，可包含接受、拒绝或取消结果。",
        PostToolUse:"Claude Code 工具成功返回后触发，失败另记为 PostToolUseFailure；Codex 的工具结果由返回内容判断成功或失败。",
        PostToolUseFailure:"Claude Code 工具调用失败后触发，与导致整轮回复失败的 API 错误分别记录。",
        PostToolBatch:"一批工具调用全部结束后、下一次模型请求前触发；每批一次，各工具仍有自己的结果事件。",
        SubagentStart:"子 Agent 启动时触发；其工具调用和响应结束可另外记录。",
        SubagentStop:"子 Agent 结束当前响应时触发；Claude Code 的其他 hook 可要求它继续工作。",
        TaskCreated:"通过 TaskCreate 创建任务时触发；其他 hook 仍可阻止创建，因此计数表示事件发生次数。",
        TaskCompleted:"任务即将被标记为已完成时触发；其他 hook 可阻止完成，因此计数表示完成检查次数。",
        TeammateIdle:"Agent 团队队友即将转为空闲时触发；其他 hook 可要求它继续工作。",
        Stop:"Agent 结束当前响应时触发；Claude Code 的其他 hook 可要求继续，因此事件计数不等同于任务交付数。",
        StopFailure:"Claude Code 因 API 错误无法完成本轮回复时触发，例如限流、鉴权失败或服务异常。",
        Interrupt:"Codex 用户中断执行时触发。Claude Code 没有同名事件，工具失败和会话结束分别记录。",
        PreCompact:"上下文压缩开始前触发，可由手动操作或自动压缩触发。",
        PostCompact:"上下文压缩完成后触发；对应一次手动或自动压缩。",
        PreModelSwitch:"Claude Code 应用用户或客户端请求的模型切换之前触发；自动回退和恢复模型只触发切换后事件。",
        PostModelSwitch:"会话模型更改后触发，也包括自动回退或恢复会话时还原模型。",
        Setup:"显式执行初始化或维护时触发；--init-only，或 -p 模式下的 --init / --maintenance。",
        InstructionsLoaded:"CLAUDE.md 或 .claude/rules/*.md 加载进上下文时触发，包含启动、延迟加载或压缩后重新加载。",
        ConfigChange:"会话期间配置文件发生变更时触发；其他 hook 仍可阻止新配置生效。",
        CwdChanged:"主会话中的 shell 命令改变工作目录时触发，例如执行 cd。",
        DirectoryAdded:"会话中通过 /add-dir 或 SDK 添加工作目录后触发；表示加入工作范围。",
        FileChanged:"受监视文件在磁盘上发生变化时触发；变更可能来自 Agent、脚本或外部程序。",
        WorktreeCreate:"创建隔离工作副本时触发；此 hook 接管默认创建流程，需由自定义创建器提供实际目录。",
        WorktreeRemove:"移除由自定义 WorktreeCreate 创建的隔离工作副本时触发。",
        Notification:"Claude Code 发出系统通知时触发，例如权限提示、空闲提醒或认证通知。",
        MessageDisplay:"助手文本在界面中显示或流式更新时触发；作用于显示层，单条消息可触发多次。",
      },
      hookViewLifecycle:'生命周期', hookViewCategories:'分类统计',
      hookLifecycleNote:'按典型流程展示关系；次数为所选日期内全部会话的汇总。分支按需触发，实际顺序见活动日志。',
      hookCategoriesNote:'按用途汇总每种事件的接收次数；分类合计包含重复调用，不代表独立任务数。',
      hookActionNote:'悬停查看触发说明，点击事件卡片查看日志；角标表示支持的 Agent。',
      hookOpenLog:'查看 {hook} 的活动日志', hookSession:'会话开始', hookSessionEnd:'会话结束',
      hookSessionGroup:'会话与消息', hookPrompt:'接收消息', hookPromptNote:'用户命令展开为提示词时触发，如 /skillname；普通消息可跳过。',
      hookTurn:'每个消息回合', hookTurnNote:'一段会话可包含多个回合；收尾后可接收下一条消息。',
      hookCycle:'Agent 工具循环', hookBeforeTool:'准备调用工具', hookPermission:'按需 · 权限确认',
      hookPermissionNote:'调用需要权限决策时触发；自动模式拒绝单独记录，拒绝后本次调用不执行。',
      hookMcp:'按需 · MCP 输入', hookMcpNote:'工具运行过程中请求用户补充信息时触发。',
      hookExecute:'工具执行', hookExecuteNote:'实际工具运行，此处没有独立 Hook。',
      hookResults:'工具结果 / 失败', hookBatch:'可选 · 工具批次收尾',
      hookBatchNote:'一批工具调用全部结束后、下一次模型请求前触发；各工具仍有独立结果事件。',
      hookRepeat:'↺ 处理结果后，可继续调用工具或进入回合收尾',
      hookFinish:'回合收尾', hookFinishNote:'响应结束、API 错误或用户中断分别记录；Stop hook 可要求继续，次数不等于任务交付数。',
      hookSessionRepeat:'↺ 继续对话时进入下一回合；关闭会话时触发 SessionEnd。',
      hookBranches:'条件事件与旁路', hookBranchesNote:'这些事件可在工作过程中穿插，不是必须经过的后续步骤。',
      hookToolsGroup:'工具调用', hookPermissionGroup:'权限与 MCP',
      hookTeamGroup:'子 Agent 与任务协作', hookTeamNote:'子 Agent 响应、任务创建/完成检查与队友转为空闲分别触发，可并行发生。',
      hookContextGroup:'上下文与模型', hookContextNote:'压缩前后、请求模型切换前与模型更改后分别记录；自动切换可能仅触发后者。',
      hookEnvironmentGroup:'初始化与工作环境', hookEnvironmentNote:'显式初始化/维护、指令加载，以及配置、监视文件、工作副本和工作目录变化。',
      hookMessagesGroup:'通知与显示', hookMessagesNote:'助手文本显示与系统通知分别记录；流式显示可能多次触发。',
      pageTitle:"STAR OFFICE · AI Agent 像素办公室",
      achievements:"常规成就",
      achievementNote:"8 条成长线，每条包含基础、里程碑和进阶徽章，共 24 枚。前两档只解锁一次，进阶累计门槛逐级翻倍。全成就只计算这 24 枚，隐藏探索与月度徽章单独收藏。",
      collectionRule:"解锁全部 {count} 枚常规徽章；进阶达到 Lv.1 即可。隐藏探索和月度徽章不参与。",
      explorationTitle:"趣味探索",
      explorationNote:"9 段办公室见闻，集齐后揭晓第 10 枚纪念。未解锁时保留秘密；独立于常规成就和月度收藏，按全部历史记录计算。",
      explorationLocked:"待解锁成就",
      explorationCount:"{count} / {total} 已发现",
      weekend_worker:"周末加班",
      night_owl:"夜猫子",
      early_bird:"晨光来客",
      session_resumed:"旧事新篇",
      second_wind:"柳暗花明",
      exploration_master:"办公室探秘家",
      explorationRule_session_closed:"结束过一个会话，给今天的工作画上句号。",
      explorationRule_first_compact:"开始过一次上下文整理，给思路腾点空间。",
      explorationRule_first_permission:"遇到过一次权限确认，停下来等一个点头。",
      explorationRule_tool_chain:"同一角色、同一会话的一个回合中，成功执行至少 3 次不同的工具调用后结束回合。",
      explorationRule_weekend_worker:"在周六或周日结束过一个回合。",
      explorationRule_night_owl:"在 22:00 至次日 05:00 前结束过一个回合。",
      explorationRule_early_bird:"在 05:00 至 08:00 前提交过一个任务。",
      explorationRule_session_resumed:"通过恢复入口重新开启过一个已有会话。",
      explorationRule_second_wind:"同一角色、同一会话中，权限等待后成功执行工具，或工具失败后成功完成另一工具调用。",
      explorationRule_exploration_master:"发现全部 9 段办公室见闻，集齐这份特别的纪念。",
      explorationTimeNote:"时间类探索按后端本地时区和真实任务事件判定，挂机与心跳不触发。",
      collectionDone:"全部集齐，收藏圆满。继续提升进阶等级吧！",
      badgeMilestone:"里程碑",
      group_prompts:"任务委托",
      group_turns:"回合交付",
      group_tool_attempts:"工具探索",
      group_tools:"工具成果",
      group_delegation:"协作发起",
      group_team:"协作收尾",
      session_10:"办公室常客",
      first_prompt:"新的委托",
      prompt_25:"任务接力",
      prompt_100:"运筹帷幄",
      turn_25:"稳步交付",
      first_tool:"工具上手",
      tool_started_100:"实践能手",
      tool_started_1000:"开拓先锋",
      tool_100:"工具熟练者",
      compact_10:"思路常新",
      first_delegate:"邀请搭档",
      delegate_5:"组建小队",
      delegate_10:"协作指挥官",
      teamwork_5:"配合渐佳",
      session_closed:"好好道别",
      first_compact:"整理行囊",
      first_permission:"等待确认",
      tool_chain:"一气呵成",
      collectionSubtitle:"长久成长，每月留念",
      badgeTierHint:"阶段星标：Lv.2 / 3 / 5 / 7 / 10；等级无上限",
      badgeBasic:"基础",
      badgeAdvanced:"进阶",
      badgeFirstUnlock:"首次解锁：{rule}",
      badgeDoubling:"每升一级，累计目标翻倍",
      badgeNextTotal:"下一级累计目标：{count}",
      collectionTitle:"徽章收藏",
      collectionName:"全成就 · 办公室收藏家",
      monthlyTitle:"本月挑战",
      monthlyRule:"三项全部达成即可点亮；活跃天数无需连续。",
      monthlyDays:"本月还剩 {count} 天（含今天）",
      monthlyDone:"本月徽章已入藏",
      monthly_active_days:"活跃天数",
      monthly_prompts:"提交消息",
      monthly_tools:"成功工具调用",
      monthlyArchive:"月度收藏",
      monthlyCount:"已收藏 {count} 枚",
      monthlyEmpty:"首枚月度徽章正在路上。",
      monthlyNote:"按后端本地自然月计算，与日期筛选无关。消息提交、收工或工具成功计为活跃；历史达标月份自动入藏，新月重新计数。",
      monthlyThemes:["新年启程", "暖灯相伴", "春芽初生", "雨后新绿", "向阳而行", "夏日微光", "盛夏星河", "逐风远行", "金秋来信", "收获时节", "炉边小憩", "岁末星光"],
      badgeGrowing:"可成长",
      badgeLevelProgress:"升级进度",
      badgeNextLevel:"升至 Lv.{level}",
      badgeLifetime:"累计：{rule}",
      badgeRemaining:"还需 {count} 次",
      badgeNoneGrowing:"还没有可成长的徽章。",
      badgePin:"＋ 关注",
      badgeUnpin:"取消关注",
      badgePinLimit:"最多关注 3 枚，请先取消一枚。",
      goalTitle:"关注目标",
      goalNote:"最多关注 3 枚成长徽章；选择保存在当前浏览器。",
      goalEmpty:"挑几枚想继续积累的徽章，在这里查看下一级进度。",
      goalChoose:"选择成长徽章 ↓",
      goalCount:"{count} / 3 已关注",
      tier_0:"待启程",
      tier_1:"起步",
      tier_2:"铜星",
      tier_3:"银星",
      tier_5:"金星",
      tier_7:"星耀",
      tier_10:"传奇",
      badgeAll:"全部成就",
      badgeLocked:"未解锁",
      badgeEarned:"已解锁",
      badgeProgress:"解锁进度",
      badgeView:"查看成就",
      badgeVisible:"显示 {count} 项",
      badgeNoneEarned:"还没有解锁的成就。收到对应活动后会自动点亮。",
      badgeNoneLocked:"全部成就已解锁。",
      group_sessions:"启程与会话",
      group_context:"上下文整理",
      first_session:"初来办公室",
      session_50:"资深常驻",
      turn_100:"有始有终",
      first_tool_success:"初试成功",
      tool_1000:"工具宗师",
      compact_50:"记忆典藏",
      teamwork_10:"默契团队",
      rule_SessionStart:"开始 {target} 个会话",
      rule_SessionEnd:"结束 {target} 个会话",
      rule_UserPromptSubmit:"提交 {target} 个任务回合",
      rule_Stop:"结束 {target} 个回合",
      rule_PreToolUse:"发起 {target} 次工具调用",
      rule_PostToolUse:"成功执行 {target} 次工具",
      rule_PreCompact:"开始 {target} 次上下文整理",
      rule_PostCompact:"完成 {target} 次上下文整理",
      rule_SubagentStart:"启动 {target} 次子 Agent 协作",
      rule_SubagentStop:"收到 {target} 次子 Agent 收尾",
      rule_PermissionRequest:"收到 {target} 次权限确认请求",
      back:'← 返回办公室',title:'活动档案',subtitle:'从像素办公室，到你的 AI 活动档案。',
      loading:'正在读取记录…',live:'每 10 秒更新',today:'今日',week:'近 7 天',month:'近 30 天',all:'全部',
      export:'导出最近 200 条',journey:'办公室成长记录',next:'下一等级',states:'角色状态',countTime:'次数 / 观测时长',
      trend:'每日活动',events:'接收事件',trendNote:'全部视图显示最近 30 天趋势。',hooks:'AI Agent 生命周期',hookNote:'Codex 12 类 / Claude Code 33 类 · 6 种动画状态',
      details:'运行概览',log:'活动日志',stateFilter:'状态筛选',hookFilter:'事件筛选',allStates:'全部状态',allHooks:'全部事件',
      measurement:'次数按实际接收事件统计，心跳单独标记；多 Agent 时长累加，每次状态最多观测 5 分钟，断联时间不累加。',
      scoreNote:'经验值是活动纪念：回合结束 +20，工具成功 +2，子 Agent 收尾 +10。次数与经验值不代表任务质量或 Token 用量。',
      empty:'还没有活动。接入 Codex / Claude Code hooks，或推送一次状态，记录就会从这里开始。',noMatch:'所选条件下没有活动。',failed:'读取失败，稍后自动重试。',
      turns:'结束回合',tools:'工具执行',active:'工作观测时长',heartbeat:'心跳',transitions:'状态切换',sessions:'会话',permissions:'权限等待',
      interrupts:'中断',compactions:'上下文整理',subagents:'子 Agent 启动',errors:'工具错误',stateUpdates:'主动状态更新',
      average:'工具平均耗时',measured:'个配对样本',xpPeriod:'本期经验值',late:'迟到事件，未改变角色',observed:'观察事件，未改变角色',online:'在线',offline:'离线',
      mainCharacter:'主角色',codexDriver:'Codex hooks',claudeDriver:'Claude Code hooks',stateDriver:'主动调用',lastUpdate:'最近更新',presenceNote:'Star 为办公室主角色，在线按最近 5 分钟收到的状态更新判断。',
      first_turn:'初次收工',teamwork:'协作伙伴',context_keeper:'记忆管理员',
      stateLabels:['待命','写作','调研','执行','同步','异常'],hookLabels:["提示词提交","工具调用前","权限决策请求","工具调用结果","会话开始/恢复","会话结束","子 Agent 启动","子 Agent 响应结束","上下文压缩前","上下文压缩后","响应结束","用户中断","初始化与维护","指令文件加载","配置文件变更","命令展开为提示词","助手消息显示","系统通知","工具批次结束","工具调用失败","自动模式权限拒绝","API 响应失败","MCP 请求用户输入","MCP 用户响应回传前","任务创建时","任务完成前","队友空闲前","受监视文件变更","工作目录变更","工作目录添加","工作副本创建","工作副本移除","模型切换前","模型切换后"]
    },
    en: {
      boardActivity:'Agent message board', boardOpen:'Read discussions ↗', boardScope:'Local Codex board · All history, independent of the date filter above', boardMessages:'Discussion posts', boardTopics:'Topics', boardAgents:'Agents', boardChannels:'Channels',
      hookViewLifecycle:'Lifecycle', hookViewCategories:'Categories',
      hookLifecycleNote:'Typical lifecycle relationships; counts combine all sessions in the selected dates. Branches are conditional. See the activity log for actual order.',
      hookCategoriesNote:'Received events grouped by purpose. Totals include repeated calls and do not count unique tasks.',
      hookActionNote:'Select an event card to view its log. Corner dots show which agents support it.',
      hookOpenLog:'View activity log for {hook}', hookSession:'Session starts', hookSessionEnd:'Session ends',
      hookSessionGroup:'Sessions and prompts', hookPrompt:'Receive a prompt', hookPromptNote:'Prompt expansion is optional.',
      hookTurn:'Each message turn', hookTurnNote:'A session can contain many turns; the next prompt starts another turn.',
      hookCycle:'Agent tool loop', hookBeforeTool:'Prepare tool call', hookPermission:'Conditional · Permission',
      hookPermissionNote:'Skip when approval is unnecessary; denied calls do not execute. PermissionDenied is specific to Claude Code auto mode.',
      hookMcp:'Conditional · MCP input', hookMcpNote:'When a running tool requests more information from the user.',
      hookExecute:'Tool executes', hookExecuteNote:'Actual tool execution; no separate hook at this step.',
      hookResults:'Tool result / failure', hookBatch:'Optional · Tool batch',
      hookBatchNote:'Claude Code fires this after a batch finishes, before the next model request; each tool still has its own result event.',
      hookRepeat:'↺ Process results, then call another tool or finish the turn',
      hookFinish:'Turn finishes', hookFinishNote:'Normal finish, response failure, or user interruption. Stop does not close the session.',
      hookSessionRepeat:'↺ Continue with another turn, or close the session with SessionEnd.',
      hookBranches:'Conditional events', hookBranchesNote:'These can occur during work; they are not mandatory next steps.',
      hookToolsGroup:'Tool calls', hookPermissionGroup:'Permissions and MCP',
      hookTeamGroup:'Subagents and tasks', hookTeamNote:'Subagent, task and teammate events are independent and may run alongside the main agent.',
      hookContextGroup:'Context and models', hookContextNote:'Compaction and model changes resume current work when finished.',
      hookEnvironmentGroup:'Setup and workspace', hookEnvironmentNote:'Setup, instructions, configuration, worktrees, directory and file changes.',
      hookMessagesGroup:'Notifications and display', hookMessagesNote:'Message display and asynchronous notifications are separate from the tool loop.',
      pageTitle:"STAR OFFICE · AI Agent Pixel Office",
      achievements:"Regular achievements",
      achievementNote:"8 growth tracks, each with a basic badge, a fixed milestone and an advanced badge: 24 in total. The first two unlock once; advanced cumulative targets double. Only these 24 count toward full collection. Hidden and monthly badges are separate.",
      collectionRule:"Unlock all {count} regular badges. Advanced badges need Lv.1. Hidden discoveries and monthly badges are not required.",
      explorationTitle:"Office discoveries",
      explorationNote:"Discover 9 office moments to reveal a tenth keepsake. Locked badges keep their secrets. Uses full history, separate from regular achievements and monthly badges.",
      explorationLocked:"Undiscovered achievement",
      explorationCount:"{count} / {total} discovered",
      weekend_worker:"Weekend shift",
      night_owl:"Night owl",
      early_bird:"Early bird",
      session_resumed:"Picking up the thread",
      second_wind:"A second wind",
      exploration_master:"Office explorer",
      explorationRule_session_closed:"Ended a session and put a full stop to the work.",
      explorationRule_first_compact:"Started a context compaction to make room for new thoughts.",
      explorationRule_first_permission:"Encountered a permission request and waited for the go-ahead.",
      explorationRule_tool_chain:"Completed a turn after at least 3 distinct successful tool calls by the same actor in the same session.",
      explorationRule_weekend_worker:"Ended a turn on a Saturday or Sunday.",
      explorationRule_night_owl:"Ended a turn from 22:00 until before 05:00.",
      explorationRule_early_bird:"Submitted a task from 05:00 until before 08:00.",
      explorationRule_session_resumed:"Resumed an existing session.",
      explorationRule_second_wind:"After a permission wait or a failed tool, the same actor successfully completed a tool in the same session; failure recovery requires a different call.",
      explorationRule_exploration_master:"Discovered all 9 office moments and earned this special keepsake.",
      explorationTimeNote:"Time discoveries use the backend’s local timezone and real task events. Idle time and heartbeats do not trigger them.",
      collectionDone:"Every badge collected. Keep growing your advanced badges!",
      badgeMilestone:"Milestone",
      group_prompts:"Task assignments",
      group_turns:"Turn finishes",
      group_tool_attempts:"Tool exploration",
      group_tools:"Tool results",
      group_delegation:"Starting collaborations",
      group_team:"Team finishes",
      session_10:"Office regular",
      first_prompt:"New assignment",
      prompt_25:"Task relay",
      prompt_100:"Master planner",
      turn_25:"Steady finishes",
      first_tool:"Tool debut",
      tool_started_100:"Skilled practitioner",
      tool_started_1000:"Trailblazer",
      tool_100:"Tool regular",
      compact_10:"Fresh context",
      first_delegate:"Invite a partner",
      delegate_5:"Build a team",
      delegate_10:"Collaboration commander",
      teamwork_5:"Finding our rhythm",
      session_closed:"A proper goodbye",
      first_compact:"Pack your thoughts",
      first_permission:"Awaiting approval",
      tool_chain:"A smooth run",
      collectionSubtitle:"Keep growing. Collect each month.",
      badgeTierHint:"Star milestones: Lv.2 / 3 / 5 / 7 / 10. Levels have no cap.",
      badgeBasic:"Basic",
      badgeAdvanced:"Advanced",
      badgeFirstUnlock:"First unlock: {rule}",
      badgeDoubling:"Each level doubles the cumulative target",
      badgeNextTotal:"Next cumulative target: {count}",
      collectionTitle:"Badge collection",
      collectionName:"Full collection · Office collector",
      monthlyTitle:"This month",
      monthlyRule:"Meet all three goals to unlock. Active days need not be consecutive.",
      monthlyDays:"{count} days left, including today",
      monthlyDone:"This month’s badge is collected",
      monthly_active_days:"Active days",
      monthly_prompts:"Messages submitted",
      monthly_tools:"Successful tools",
      monthlyArchive:"Monthly collection",
      monthlyCount:"{count} collected",
      monthlyEmpty:"Your first monthly badge is on its way.",
      monthlyNote:"Uses the backend’s local calendar month, independent of date filters. Message submissions, finishes or successful tools count as activity. Qualifying past months are collected automatically; new months start fresh.",
      monthlyThemes:["New beginnings", "Warm lamplight", "First sprouts", "After the rain", "Toward the sun", "Summer glow", "Summer stars", "Following the wind", "Autumn letters", "Harvest time", "By the hearth", "Year-end starlight"],
      badgeGrowing:"Growing",
      badgeLevelProgress:"Level progress",
      badgeNextLevel:"Next: Lv.{level}",
      badgeLifetime:"Lifetime: {rule}",
      badgeRemaining:"{count} more to go",
      badgeNoneGrowing:"No growing badges yet.",
      badgePin:"+ Follow",
      badgeUnpin:"Unfollow",
      badgePinLimit:"Follow up to 3 badges. Unfollow one first.",
      goalTitle:"Followed goals",
      goalNote:"Follow up to 3 growing badges. Your choices are saved in this browser.",
      goalEmpty:"Choose badges to keep working toward and track their next level here.",
      goalChoose:"Choose growing badges ↓",
      goalCount:"{count} / 3 followed",
      tier_0:"Not started",
      tier_1:"Beginning",
      tier_2:"Bronze",
      tier_3:"Silver",
      tier_5:"Gold",
      tier_7:"Stellar",
      tier_10:"Legendary",
      badgeAll:"All badges",
      badgeLocked:"Locked",
      badgeEarned:"Unlocked",
      badgeProgress:"Achievement progress",
      badgeView:"View achievements",
      badgeVisible:"Showing {count}",
      badgeNoneEarned:"No achievements yet. Matching activity will unlock them automatically.",
      badgeNoneLocked:"All achievements unlocked.",
      group_sessions:"Arrivals & sessions",
      group_context:"Context care",
      first_session:"First arrival",
      session_50:"Long-time resident",
      turn_100:"See it through",
      first_tool_success:"First success",
      tool_1000:"Tool grandmaster",
      compact_50:"Memory archive",
      teamwork_10:"Team in harmony",
      rule_SessionStart:"Start {target} sessions",
      rule_SessionEnd:"End {target} sessions",
      rule_UserPromptSubmit:"Submit {target} task turns",
      rule_Stop:"End {target} turns",
      rule_PreToolUse:"Start {target} tool calls",
      rule_PostToolUse:"Complete {target} successful tool calls",
      rule_PreCompact:"Start {target} context compactions",
      rule_PostCompact:"Finish {target} context compactions",
      rule_SubagentStart:"Start {target} subagent collaborations",
      rule_SubagentStop:"Receive {target} subagent finishes",
      rule_PermissionRequest:"Receive {target} permission requests",
      back:'← Back to office',title:'Activity archive',subtitle:'Your pixel office, with a record of the work behind it.',
      loading:'Reading activity…',live:'Updates every 10s',today:'Today',week:'7 days',month:'30 days',all:'All time',
      export:'Export latest 200',journey:'OFFICE PROGRESS',next:'Next level',states:'Character states',countTime:'Count / observed time',
      trend:'Daily activity',events:'Events received',trendNote:'All-time view shows the last 30 days.',hooks:'AI Agent lifecycle',hookNote:'Codex: 12 / Claude Code: 33 events · 6 states',
      details:'Run overview',log:'Activity log',stateFilter:'State filter',hookFilter:'Event filter',allStates:'All states',allHooks:'All events',
      measurement:'Counts reflect received events; heartbeats are marked separately. Actor times are summed, capped at 5 minutes per update; disconnected time is excluded.',
      scoreNote:'Activity keepsakes: turn ended +20 XP, successful tool +2, subagent ended +10. Counts and XP do not measure task quality or token usage.',
      empty:'No activity yet. Connect Codex / Claude Code hooks or send a state update to start your record.',noMatch:'No activity matches these filters.',failed:'Could not load activity. Retrying automatically.',
      turns:'Turns ended',tools:'Tools completed',active:'Observed work',heartbeat:'Heartbeats',transitions:'State changes',sessions:'Sessions',permissions:'Permission requests',
      interrupts:'Interruptions',compactions:'Compactions',subagents:'Subagents started',errors:'Tool errors',stateUpdates:'State updates',
      average:'Average tool time',measured:'paired samples',xpPeriod:'XP this period',late:'Late event; character unchanged',online:'online',offline:'offline',
      mainCharacter:'Main character',codexDriver:'Codex hooks',claudeDriver:'Claude Code hooks',observed:'Observation; actor unchanged',stateDriver:'State updates',lastUpdate:'Last update',presenceNote:'Star is the main office character. Presence reflects state updates received within the last 5 minutes.',
      first_turn:'First finish',teamwork:'Team player',context_keeper:'Memory keeper',
      stateLabels:['Idle','Writing','Research','Executing','Syncing','Error'],hookLabels:["Prompt submitted","Before tool","Permission decision","Tool result","Session starts / resumes","Session ends","Subagent starts","Subagent response ends","Before context compaction","After context compaction","Response ends","Interrupted","Initialization / maintenance","Instruction file loaded","Config changed","Command expands to prompt","Assistant text displayed","Notification","Tool batch ends","Tool failure","Auto-mode permission denied","API response failure","MCP input requested","Before MCP reply","Task creation","Before task completion","Before teammate idle","Watched file changed","Working directory changed","Working directory added","Worktree creation","Worktree removal","Before model switch","After model switch"]
    },
    ja: {
      boardActivity:'Agent 掲示板', boardOpen:'議論を読む ↗', boardScope:'Codex のローカル掲示板 · 全履歴（日付の絞り込み対象外）', boardMessages:'協作の投稿', boardTopics:'トピック', boardAgents:'参加 Agent', boardChannels:'チャンネル',
      hookViewLifecycle:'ライフサイクル', hookViewCategories:'分類統計',
      hookLifecycleNote:'典型的な流れを表示。回数は選択期間の全セッションの合計です。分岐は必要に応じて発生し、実際の順序は活動ログで確認できます。',
      hookCategoriesNote:'受信イベントを用途別に集計。繰り返し呼び出しを含むため、個別タスク数ではありません。',
      hookActionNote:'イベントカードから対応するログへ。角の印は対応する Agent を示します。',
      hookOpenLog:'{hook} の活動ログを表示', hookSession:'セッション開始', hookSessionEnd:'セッション終了',
      hookSessionGroup:'セッションとメッセージ', hookPrompt:'メッセージ受付', hookPromptNote:'プロンプト展開は任意のイベントです。',
      hookTurn:'メッセージごとのターン', hookTurnNote:'1 セッションに複数のターンがあり、次のメッセージで新しいターンが始まります。',
      hookCycle:'Agent ツールループ', hookBeforeTool:'ツール呼び出し準備', hookPermission:'必要時 · 権限確認',
      hookPermissionNote:'確認が不要なら省略。拒否された呼び出しは実行しません。拒否イベントは Claude Code の自動権限モードのみです。',
      hookMcp:'必要時 · MCP 入力', hookMcpNote:'実行中のツールがユーザーに追加情報を求めた場合に発生します。',
      hookExecute:'ツール実行', hookExecuteNote:'実際のツール実行。この段階に独立した Hook はありません。',
      hookResults:'ツール結果 / 失敗', hookBatch:'任意 · ツールバッチ終了',
      hookBatchNote:'ツールバッチ全体が終了し、次のモデル要求を送る前に発生。各ツールの結果も記録されます。',
      hookRepeat:'↺ 結果を処理し、次のツール呼び出しまたはターン終了へ',
      hookFinish:'ターン終了', hookFinishNote:'通常終了、応答失敗、またはユーザー中断。Stop はセッション終了を意味しません。',
      hookSessionRepeat:'↺ 次のターンへ進むか、SessionEnd でセッションを閉じます。',
      hookBranches:'条件付きイベント', hookBranchesNote:'作業中に随時発生し、必須の後続手順ではありません。',
      hookToolsGroup:'ツール呼び出し', hookPermissionGroup:'権限と MCP',
      hookTeamGroup:'子 Agent とタスク', hookTeamNote:'子 Agent、タスク、チームメイトのイベントは独立し、主 Agent と並行して発生します。',
      hookContextGroup:'コンテキストとモデル', hookContextNote:'圧縮やモデル切り替え後に現在の作業を続行します。',
      hookEnvironmentGroup:'初期化と作業環境', hookEnvironmentNote:'準備、指示、設定、作業コピー、ディレクトリとファイルの変更。',
      hookMessagesGroup:'通知と表示', hookMessagesNote:'メッセージ表示と非同期通知はツールループから独立しています。',
      pageTitle:"STAR OFFICE · AI Agent ピクセルオフィス",
      achievements:"通常の実績",
      achievementNote:"8 系統に基本・節目・上級を各 1 個、合計 24 個。基本と節目は一度だけ解除し、上級の累計目標は倍増します。全実績の条件はこの 24 個のみ。隠し実績と月間バッジは別枠です。",
      collectionRule:"通常バッジ {count} 個をすべて解除。上級は Lv.1 で達成。隠し実績と月間バッジは条件に含みません。",
      explorationTitle:"オフィスの発見",
      explorationNote:"9 つの体験を集めると 10 個目の記念が現れます。未解除の内容は秘密。全履歴で判定し、通常の実績・月間バッジとは別枠です。",
      explorationLocked:"未発見の実績",
      explorationCount:"{count} / {total} 発見",
      weekend_worker:"週末のオフィス",
      night_owl:"夜ふかしさん",
      early_bird:"朝の来訪者",
      session_resumed:"続きの物語",
      second_wind:"再び前へ",
      exploration_master:"オフィス探検家",
      explorationRule_session_closed:"セッションを終了し、仕事に区切りをつけた。",
      explorationRule_first_compact:"コンテキスト整理を開始し、新しい思考の場所を作った。",
      explorationRule_first_permission:"権限の確認を受け、承認を待った。",
      explorationRule_tool_chain:"同じキャラクター・同じセッションの 1 ターンで、異なるツール呼び出しを 3 回以上正常に完了してからターンを終了した。",
      explorationRule_weekend_worker:"土曜日または日曜日にターンを終了した。",
      explorationRule_night_owl:"22:00 から翌 05:00 未満にターンを終了した。",
      explorationRule_early_bird:"05:00 から 08:00 未満にタスクを提出した。",
      explorationRule_session_resumed:"既存のセッションを再開した。",
      explorationRule_second_wind:"同じキャラクター・同じセッションで、権限待ちの後にツールを正常に実行、または失敗の後に別のツール呼び出しを正常に完了した。",
      explorationRule_exploration_master:"9 つのオフィス体験をすべて発見し、特別な記念を獲得。",
      explorationTimeNote:"時間の発見はバックエンドの現地時間と実際のタスクで判定します。放置やハートビートでは解除されません。",
      collectionDone:"すべて収集！上級バッジの成長を続けましょう。",
      badgeMilestone:"節目",
      group_prompts:"タスク依頼",
      group_turns:"ターンの完了",
      group_tool_attempts:"ツールの探索",
      group_tools:"ツールの成果",
      group_delegation:"協力の開始",
      group_team:"協力の完了",
      session_10:"オフィスの常連",
      first_prompt:"新しい依頼",
      prompt_25:"タスクリレー",
      prompt_100:"戦略の達人",
      turn_25:"着実な完了",
      first_tool:"ツール入門",
      tool_started_100:"実践上手",
      tool_started_1000:"開拓の先駆者",
      tool_100:"ツール名人",
      compact_10:"新鮮な思考",
      first_delegate:"仲間を招待",
      delegate_5:"チーム結成",
      delegate_10:"協力の指揮官",
      teamwork_5:"息が合ってきた",
      session_closed:"丁寧なお別れ",
      first_compact:"思考の荷造り",
      first_permission:"確認待ち",
      tool_chain:"一気に完遂",
      collectionSubtitle:"長く育て、毎月の記念に",
      badgeTierHint:"星の段階：Lv.2 / 3 / 5 / 7 / 10。レベルに上限はありません。",
      badgeBasic:"基本",
      badgeAdvanced:"上級",
      badgeFirstUnlock:"初回解除：{rule}",
      badgeDoubling:"レベルごとに累計目標が 2 倍に",
      badgeNextTotal:"次の累計目標：{count}",
      collectionTitle:"バッジコレクション",
      collectionName:"全実績 · オフィス収集家",
      monthlyTitle:"今月のチャレンジ",
      monthlyRule:"3 条件をすべて達成すると解除。活動日は連続でなくても構いません。",
      monthlyDays:"今月は残り {count} 日（今日を含む）",
      monthlyDone:"今月のバッジを獲得",
      monthly_active_days:"活動日数",
      monthly_prompts:"メッセージ送信",
      monthly_tools:"ツール成功",
      monthlyArchive:"月間コレクション",
      monthlyCount:"{count} 個を収集",
      monthlyEmpty:"最初の月間バッジを目指しましょう。",
      monthlyNote:"バックエンドの現地暦月で集計し、期間選択には影響されません。メッセージ送信・ターン終了・ツール成功を活動とします。過去の達成月も自動収集し、新しい月はゼロから開始します。",
      monthlyThemes:["新年の旅立ち", "暖かな灯り", "春の芽吹き", "雨上がり", "太陽へ", "夏の光", "夏の星空", "風を追って", "秋の便り", "実りの季節", "炉辺の休息", "年末の星明かり"],
      badgeGrowing:"成長できる",
      badgeLevelProgress:"レベル進捗",
      badgeNextLevel:"次は Lv.{level}",
      badgeLifetime:"累計：{rule}",
      badgeRemaining:"あと {count} 回",
      badgeNoneGrowing:"成長できるバッジはまだありません。",
      badgePin:"＋ 注目",
      badgeUnpin:"注目を解除",
      badgePinLimit:"注目できるのは 3 個までです。先に 1 個解除してください。",
      goalTitle:"注目の目標",
      goalNote:"成長バッジを 3 個まで選べます。選択はこのブラウザーに保存されます。",
      goalEmpty:"積み重ねたいバッジを選んで、次のレベルへの進捗を確認しましょう。",
      goalChoose:"成長バッジを選ぶ ↓",
      goalCount:"{count} / 3 個を選択中",
      tier_0:"未開始",
      tier_1:"はじまり",
      tier_2:"銅の星",
      tier_3:"銀の星",
      tier_5:"金の星",
      tier_7:"星の輝き",
      tier_10:"伝説",
      badgeAll:"すべて",
      badgeLocked:"未達成",
      badgeEarned:"達成済み",
      badgeProgress:"実績の進捗",
      badgeView:"実績を見る",
      badgeVisible:"{count} 件を表示",
      badgeNoneEarned:"まだ実績はありません。対応する活動を受信すると自動で達成されます。",
      badgeNoneLocked:"すべての実績を達成しました。",
      group_sessions:"出発とセッション",
      group_context:"コンテキスト整理",
      first_session:"はじめまして",
      session_50:"ベテランの住人",
      turn_100:"最後までやり抜く",
      first_tool_success:"初めての成功",
      tool_1000:"ツールの巨匠",
      compact_50:"記憶の書庫",
      teamwork_10:"息の合うチーム",
      rule_SessionStart:"セッションを {target} 回開始",
      rule_SessionEnd:"セッションを {target} 回終了",
      rule_UserPromptSubmit:"タスクを {target} ターン送信",
      rule_Stop:"ターンを {target} 回終了",
      rule_PreToolUse:"ツールを {target} 回呼び出す",
      rule_PostToolUse:"ツールを {target} 回正常に実行",
      rule_PreCompact:"コンテキスト整理を {target} 回開始",
      rule_PostCompact:"コンテキスト整理を {target} 回完了",
      rule_SubagentStart:"子 Agent の協作を {target} 回開始",
      rule_SubagentStop:"子 Agent の終了を {target} 回受信",
      rule_PermissionRequest:"権限確認を {target} 回受信",
      back:'← オフィスに戻る',title:'活動アーカイブ',subtitle:'ピクセルオフィスから、AI の活動記録へ。',
      loading:'記録を読み込み中…',live:'10 秒ごとに更新',today:'今日',week:'7 日間',month:'30 日間',all:'全期間',
      export:'最新 200 件を出力',journey:'オフィスの成長記録',next:'次のレベル',states:'キャラクター状態',countTime:'回数 / 観測時間',
      trend:'日別の活動',events:'受信イベント',trendNote:'全期間では直近 30 日の推移を表示。',hooks:'AI Agent ライフサイクル',hookNote:'Codex 12 / Claude Code 33 イベント · 6 状態',
      details:'実行概要',log:'活動ログ',stateFilter:'状態フィルター',hookFilter:'イベントフィルター',allStates:'すべての状態',allHooks:'すべてのイベント',
      measurement:'回数は受信イベントを集計。ハートビートは別表示。複数 Agent の時間は合計し、更新ごと最大 5 分まで観測します。',
      scoreNote:'活動の記念：ターン終了 +20 XP、ツール成功 +2、子 Agent 終了 +10。品質や Token 使用量を表すものではありません。',
      empty:'まだ記録がありません。Codex / Claude Code hooks を接続するか、状態を送信してください。',noMatch:'条件に一致する活動はありません。',failed:'読み込みに失敗しました。自動再試行します。',
      turns:'終了ターン',tools:'ツール完了',active:'作業観測時間',heartbeat:'ハートビート',transitions:'状態変更',sessions:'セッション',permissions:'権限待ち',
      interrupts:'中断',compactions:'コンテキスト整理',subagents:'子 Agent 開始',errors:'ツールエラー',stateUpdates:'状態更新',
      average:'ツール平均時間',measured:'組のサンプル',xpPeriod:'期間 XP',late:'遅延イベント：状態変更なし',observed:'観測イベント：状態変更なし',online:'オンライン',offline:'オフライン',
      mainCharacter:'メインキャラクター',codexDriver:'Codex hooks',claudeDriver:'Claude Code hooks',stateDriver:'状態更新',lastUpdate:'最終更新',presenceNote:'Star はオフィスのメインキャラクターです。直近 5 分の状態更新をもとにオンラインを表示します。',
      first_turn:'初めての完了',teamwork:'協力者',context_keeper:'記憶管理者',
      stateLabels:['待機','執筆','調査','実行','同期','エラー'],hookLabels:["プロンプト送信","ツール実行前","権限判断の要求","ツール結果","セッション開始・再開","セッション終了","子 Agent 開始","子 Agent 応答終了","コンテキスト圧縮前","コンテキスト圧縮後","応答終了","中断","初期化・保守","指示ファイル読み込み","設定変更","コマンドをプロンプトへ展開","アシスタント文の表示","通知","ツールバッチ終了","ツール失敗","自動モードの権限拒否","API 応答失敗","MCP 入力要求","MCP 応答送信前","タスク作成時","タスク完了前","チームメイト待機前","監視ファイル変更","作業ディレクトリ変更","作業ディレクトリ追加","作業コピー作成時","作業コピー削除時","モデル切替前","モデル切替後"]
    }
  };
  let lang = 'zh';
  try { lang = localStorage.getItem('uiLang') || 'zh'; } catch (_) {}
  if (!TEXT[lang]) lang = 'zh';
  let period = 'today', lastData = null, controller = null, achievementFilter = 'all';
  const HOOK_VIEW_STORAGE_KEY = 'starOffice.hookView';
  let hookView = 'lifecycle';
  try {
    const saved = localStorage.getItem(HOOK_VIEW_STORAGE_KEY);
    if (['lifecycle','categories'].includes(saved)) hookView = saved;
  } catch (_) {}
  const GOALS_STORAGE_KEY = 'starOffice.achievementGoals';
  const MAX_GOALS = 3;
  const GOAL_ALIASES = {prompt_25:'prompt_100', tool_started_100:'tool_started_1000'};
  let pinnedAchievements = [];
  try {
    const saved = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) pinnedAchievements = [...new Set(saved.filter(id => typeof id === 'string').map(id => GOAL_ALIASES[id] || id))];
  } catch (_) {}
  const $ = id => document.getElementById(id);
  const t = key => TEXT[lang][key] || key;
  const element = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const number = value => Number(value || 0).toLocaleString();
  const providerDot = (kind, label) => {
    const dot = element('i', 'provider-dot ' + kind, '');
    dot.title = label;
    return dot;
  };
  const duration = seconds => seconds < 60 ? Math.round(seconds) + 's' : seconds < 3600 ? Math.round(seconds / 60) + 'm' : (seconds / 3600).toFixed(1) + 'h';
  const stateLabel = state => TEXT[lang].stateLabels[STATES.indexOf(state)] || state;
  function options(select, values, labels, first) {
    const selected = select.value;
    select.replaceChildren(new Option(first,''));
    values.forEach((value,i) => select.add(new Option(labels[i],value)));
    select.value = selected;
  }
  function translate() {
    document.documentElement.lang = lang;
    document.title = t('pageTitle') + ' · ' + t('title');
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-lang]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.lang === lang)));
    options($('state-filter'),STATES,TEXT[lang].stateLabels,t('allStates'));
    options($('hook-filter'),[...HOOKS,'StateUpdate'],[...HOOKS,t('stateUpdates')],t('allHooks'));
  }
  function renderActors(actors, office) {
    // /status selects the controller of the same Star character shown in the office.
    const mainId = office.actor_id || 'main';
    const primary = actors.find(actor => actor.actor_id === mainId);
    const hooksControlStar = ['codex','claude_code'].includes(primary?.source) && !primary.is_subagent;
    const displayed = actors.filter(actor => !(hooksControlStar && actor.actor_id === 'main'));
    displayed.sort((a,b) => Number(b.actor_id === mainId) - Number(a.actor_id === mainId)
      || Number(b.online) - Number(a.online) || b.updated_at - a.updated_at);
    $('actors').replaceChildren(...displayed.slice(0,20).map(actor => {
      const isMain = actor.actor_id === mainId;
      const label = [isMain ? 'Star' : actor.actor_name,
        isMain ? t(actor.source === 'claude_code' ? 'claudeDriver' : actor.source === 'codex' ? 'codexDriver' : 'stateDriver') : '',
        t(actor.online ? 'online' : 'offline')].filter(Boolean).join(' · ');
      const badge = element('span','actor' + (actor.online ? ' online' : ''),label);
      badge.title = [isMain ? t('mainCharacter') : '',actor.actor_name,stateLabel(actor.state),
        t('lastUpdate') + ': ' + new Date(actor.updated_at * 1000).toLocaleString()].filter(Boolean).join(' · ');
      return badge;
    }));
  }
  function toggleAchievementGoal(id, placement) {
    if (pinnedAchievements.includes(id)) {
      pinnedAchievements = pinnedAchievements.filter(value => value !== id);
    } else if (pinnedAchievements.length < MAX_GOALS) {
      pinnedAchievements.push(id);
    } else {
      return;
    }
    try { localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(pinnedAchievements)); } catch (_) {}
    renderAchievements(lastData[0].game.badges);
    const focus = $('achievement-pin-' + placement + '-' + id) || $('achievement-goals-title');
    focus.focus({preventScroll:true});
  }
  function achievementCard(badge, placement = 'cabinet') {
    const growing = !!badge.repeatable;
    const card = element('article','achievement-card' + (badge.earned ? ' earned' : '') + (growing ? ' growing' : ''));
    card.dataset.badgeId = badge.id;
    card.dataset.kind = badge.kind || (growing ? 'advanced' : badge.target === 1 ? 'basic' : 'milestone');
    if (growing) card.dataset.tier = String(badge.tier);
    const heading = element('div','achievement-heading');
    const mark = element('span','achievement-mark',badge.earned ? '✦' : '◇');
    mark.setAttribute('aria-hidden','true');
    heading.append(mark,element('h4','',t(badge.id)),
      element('span',growing && badge.earned ? 'achievement-level' : 'achievement-status',
        growing && badge.earned ? 'Lv.' + number(badge.level) : t(badge.earned ? 'badgeEarned' : 'badgeLocked')));
    const rule = t('rule_' + badge.hook).replace('{target}', number(badge.target));
    const progress = element('progress','achievement-progress');
    progress.max = growing ? badge.level_target : badge.target;
    progress.value = growing ? badge.level_progress : Math.min(badge.current, badge.target);
    const nextLevel = growing ? t('badgeNextLevel').replace('{level}', number(badge.level + 1)) : '';
    progress.setAttribute('aria-label',t(badge.id) + ' · ' + t(growing ? 'badgeLevelProgress' : 'badgeProgress') + (growing ? ' · ' + nextLevel : ''));
    card.append(heading,element('p','achievement-rule',growing ? t('badgeAdvanced') + ' · ' + t('badgeFirstUnlock').replace('{rule}',rule) + ' · ' + t('badgeDoubling') : t(card.dataset.kind === 'milestone' ? 'badgeMilestone' : 'badgeBasic') + ' · ' + rule));
    if (growing) {
      const total = t('badgeLifetime').replace('{rule}',t('rule_' + badge.hook).replace('{target}',number(badge.current)));
      card.append(element('p','achievement-total',total));
    }
    card.append(progress);
    const progressText = element('div','achievement-progress-text');
    if (growing) {
      progressText.className += ' growing-progress';
      progressText.append(element('span','',nextLevel),element('span','',t('badgeNextTotal').replace('{count}',number(badge.next_target))));
      card.append(progressText,element('p','achievement-remaining',t('badgeRemaining').replace('{count}',number(badge.remaining))));
      const footer = element('div','achievement-footer');
      const tier = element('span','achievement-tier',t('tier_' + badge.tier));
      tier.title = t('badgeTierHint');
      const pin = element('button','achievement-pin',t(pinnedAchievements.includes(badge.id) ? 'badgeUnpin' : 'badgePin'));
      pin.type = 'button';
      pin.id = 'achievement-pin-' + placement + '-' + badge.id;
      pin.disabled = !pinnedAchievements.includes(badge.id) && pinnedAchievements.length >= MAX_GOALS;
      pin.title = pin.disabled ? t('badgePinLimit') : pin.textContent + ' · ' + t(badge.id);
      pin.setAttribute('aria-label',pin.textContent + ' · ' + t(badge.id));
      pin.setAttribute('aria-pressed',String(pinnedAchievements.includes(badge.id)));
      pin.setAttribute('aria-describedby','achievement-goals-note');
      pin.addEventListener('click',() => toggleAchievementGoal(badge.id, placement));
      footer.append(tier,pin);
      card.append(footer);
    } else {
      progressText.textContent = number(Math.min(badge.current, badge.target)) + ' / ' + number(badge.target);
      card.append(progressText);
    }
    return card;
  }
  function renderAchievements(badges) {
    const focused = document.activeElement?.id;
    const growableIds = new Set(badges.filter(badge => badge.repeatable).map(badge => badge.id));
    pinnedAchievements = pinnedAchievements.filter(id => growableIds.has(id)).slice(0, MAX_GOALS);
    $('achievement-goals-count').textContent = t('goalCount').replace('{count}',number(pinnedAchievements.length));
    $('achievement-goals').replaceChildren(...pinnedAchievements.map(id => achievementCard(badges.find(badge => badge.id === id),'goal')));
    $('achievement-goals-empty').hidden = pinnedAchievements.length > 0;
    const earned = badges.filter(badge => badge.earned).length;
    const summary = earned + ' / ' + badges.length + ' ' + t('badgeEarned');
    $('achievement-count').textContent = summary;
    $('achievement-link').textContent = summary + ' · ' + t('badgeView') + ' ↓';
    const visible = badges.filter(badge => achievementFilter === 'all'
      || (achievementFilter === 'repeatable' ? badge.repeatable : achievementFilter === 'earned' ? badge.earned : !badge.earned));
    $('achievement-visible').textContent = t('badgeVisible').replace('{count}', number(visible.length));
    document.querySelectorAll('[data-achievement-filter]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.achievementFilter === achievementFilter)));
    $('badges').replaceChildren();
    for (const category of ['sessions','prompts','turns','tool_attempts','tools','context','delegation','team']) {
      const group = visible.filter(badge => badge.category === category);
      if (!group.length) continue;
      const section = element('section','achievement-group');
      section.append(element('h3','',t('group_' + category)));
      const isTrack = group.length === 3 && group.filter(badge => badge.repeatable).length === 1;
      const cards = element('div','achievement-grid' + (isTrack ? ' achievement-track' : group.length === 1 ? ' achievement-single' : ''));
      for (const badge of group) cards.append(achievementCard(badge));
      section.append(cards);
      $('badges').append(section);
    }
    if (!visible.length) {
      const emptyKey = achievementFilter === 'repeatable' ? 'badgeNoneGrowing' : achievementFilter === 'locked' ? 'badgeNoneLocked' : 'badgeNoneEarned';
      $('badges').append(element('p','empty',t(emptyKey)));
    }
    // Polling and language changes replace cards; retain keyboard focus on their controls.
    if (focused?.startsWith('achievement-pin-')) $(focused)?.focus({preventScroll:true});
  }

  function renderExploration(badges) {
    $('exploration-section').hidden = !Array.isArray(badges);
    if (!Array.isArray(badges)) return;
    $('exploration-count').textContent = t('explorationCount')
      .replace('{count}',number(badges.filter(badge => badge.earned).length))
      .replace('{total}',number(badges.length));
    $('exploration-badges').replaceChildren(...badges.map((badge,index) => {
      const revealed = badge.earned && typeof badge.id === 'string';
      const card = element('article','exploration-card' + (revealed ? ' earned' : ' locked')
        + (index === badges.length - 1 ? ' exploration-completion' : ''));
      const mark = element('div','exploration-mark',revealed ? '✦' : '?');
      mark.setAttribute('aria-hidden','true');
      // Never render a locked name, rule, progress, tooltip or descriptive ID.
      card.append(mark,element('h3','',revealed ? t(badge.id) : t('explorationLocked')));
      if (revealed) {
        card.append(element('p','',t('explorationRule_' + badge.id)),
          element('span','achievement-status',t('badgeEarned')));
      }
      return card;
    }));
  }

  function renderCollections(game) {
    const collection = game.collection, monthly = game.monthly;
    $('badge-collections').hidden = !collection || !monthly;
    if (!collection || !monthly) return;
    const trophy = $('full-collection');
    trophy.className = 'collection-card' + (collection.earned ? ' earned' : '');
    const seal = element('div','collection-seal',collection.earned ? '✦' : '◇');
    seal.setAttribute('aria-hidden','true');
    const progress = element('progress','achievement-progress');
    progress.max = collection.target;
    progress.value = collection.current;
    progress.setAttribute('aria-label',t('collectionName'));
    trophy.replaceChildren(seal,element('h3','',t('collectionName')),
      element('p','muted',t('collectionRule').replace('{count}',number(collection.target))),progress,
      element('p','collection-count',number(collection.current) + ' / ' + number(collection.target) + ' · ' + t(collection.earned ? 'badgeEarned' : 'badgeLocked')));
    if (collection.earned) trophy.append(element('p','muted',t('collectionDone')));

    const monthLabel = key => key + ' · ' + TEXT[lang].monthlyThemes[Number(key.slice(5)) - 1];
    const badge = monthly.current, panel = $('monthly-challenge');
    panel.className = 'monthly-card' + (badge.earned ? ' earned' : '');
    const heading = element('div','monthly-heading');
    const medal = element('div','monthly-seal',badge.month.slice(5));
    medal.setAttribute('aria-hidden','true');
    const title = element('div','');
    title.append(element('div','eyebrow',t('monthlyTitle')),element('h3','',monthLabel(badge.month)),
      element('p','muted',badge.earned ? t('monthlyDone') : t('monthlyDays').replace('{count}',number(badge.days_left))));
    heading.append(medal,title);
    panel.replaceChildren(heading,element('p','muted',t('monthlyRule')));
    for (const goal of badge.goals) {
      const row = element('div','monthly-goal');
      const label = element('div','progress-label');
      label.append(element('span','',t('monthly_' + goal.metric)),
        element('span','',number(Math.min(goal.current,goal.target)) + ' / ' + number(goal.target) + (goal.current >= goal.target ? ' ✓' : '')));
      const bar = element('progress','achievement-progress');
      bar.max = goal.target; bar.value = Math.min(goal.current,goal.target);
      bar.setAttribute('aria-label',t('monthly_' + goal.metric));
      row.append(label,bar); panel.append(row);
    }
    $('monthly-archive-count').textContent = t('monthlyCount').replace('{count}',number(monthly.earned.length));
    $('monthly-archive').replaceChildren(...monthly.earned.map(badge => {
      const item = element('span','monthly-keepsake','✦ ' + monthLabel(badge.month));
      item.title = t('badgeEarned');
      return item;
    }));
    if (!monthly.earned.length) $('monthly-archive').append(element('p','muted',t('monthlyEmpty')));
  }

  function hookCard(hook, counts) {
    const count = counts[hook] || 0;
    const exceptional = ['PostToolUseFailure','StopFailure','PermissionDenied','Interrupt'].includes(hook);
    const card = element('button','hook-card' + (count ? ' seen' : '') + (exceptional ? ' exceptional' : ''));
    card.type = 'button';
    card.id = 'hook-card-' + hook;
    card.dataset.hook = hook;
    const label = TEXT[lang].hookLabels[HOOKS.indexOf(hook)] || hook;
    const description = TEXT[lang].hookDescriptions?.[hook] || label;
    const providers = [CODEX_HOOKS.has(hook) ? 'Codex' : '',hook !== 'Interrupt' ? 'Claude Code' : ''].filter(Boolean).join(' / ');
    card.setAttribute('aria-label',hook + ' · ' + description + ' · ' + number(count) + ' · ' + providers + ' · ' + t('hookOpenLog').replace('{hook}',hook));
    card.setAttribute('aria-pressed',String($('hook-filter').value === hook));
    card.title = description + '\n' + t('hookOpenLog').replace('{hook}',hook);
    const dots = element('span','hook-providers');
    dots.setAttribute('aria-hidden','true');
    if (CODEX_HOOKS.has(hook)) dots.append(providerDot('codex','Codex'));
    if (hook !== 'Interrupt') dots.append(providerDot('claude','Claude Code'));
    const head = element('span','hook-head');
    head.append(element('span','hook-name',hook),dots);
    card.append(head,element('span','hook-count',number(count)),
      element('span','hook-detail',label));
    card.addEventListener('click',async () => {
      $('hook-filter').value = hook;
      const loaded = await refresh();
      if (loaded && $('hook-filter').value === hook) $('activity-log-title').focus();
    });
    return card;
  }
  function hookStage(title, hooks, counts, note, cls = '') {
    const section = element('section','hook-stage ' + cls);
    const heading = element('div','hook-stage-heading');
    heading.append(element('h3','',t(title)),
      element('span','hook-stage-total',number(hooks.reduce((sum,hook) => sum + (counts[hook] || 0),0)) + ' · ' + t('events')));
    const grid = element('div','hook-grid');
    grid.append(...hooks.map(hook => hookCard(hook,counts)));
    section.append(heading);
    if (note) section.append(element('p','hook-stage-note',t(note)));
    section.append(grid);
    return section;
  }
  function flowArrow() {
    const arrow = element('div','lifecycle-arrow','↓');
    arrow.setAttribute('aria-hidden','true');
    return arrow;
  }
  function renderHooks(counts = {}) {
    document.querySelectorAll('[data-hook-view]').forEach(button =>
      button.setAttribute('aria-pressed',String(button.dataset.hookView === hookView)));
    $('hook-view-note').textContent = t(hookView === 'lifecycle' ? 'hookLifecycleNote' : 'hookCategoriesNote');
    const root = $('hooks');
    const focusedHook = document.activeElement?.dataset?.hook;
    const restoreFocus = () => {
      if (focusedHook) $('hook-card-' + focusedHook)?.focus({preventScroll:true});
    };
    root.dataset.view = hookView;
    root.className = hookView === 'lifecycle' ? 'hook-lifecycle' : 'hook-categories';
    root.replaceChildren();
    if (hookView === 'categories') {
      HOOK_GROUPS.forEach(group => {
        const section = hookStage(group.title,group.hooks,counts);
        section.dataset.group = group.id;
        root.append(section);
      });
      restoreFocus();
      return;
    }
    const main = element('div','lifecycle-main');
    const turn = element('div','lifecycle-turn');
    turn.append(element('h3','lifecycle-region-title',t('hookTurn')),
      element('p','hook-stage-note',t('hookTurnNote')),
      hookStage('hookPrompt',['UserPromptSubmit','UserPromptExpansion'],counts,'hookPromptNote'),flowArrow());
    const cycle = element('div','lifecycle-cycle');
    cycle.append(element('h3','lifecycle-region-title',t('hookCycle')),
      hookStage('hookBeforeTool',['PreToolUse'],counts),flowArrow());
    const permission = hookStage('hookPermission',['PermissionRequest','PermissionDenied'],counts,'hookPermissionNote','conditional');
    const execution = element('div','lifecycle-execution');
    execution.append(element('strong','',t('hookExecute')),element('p','hook-stage-note',t('hookExecuteNote')));
    const branches = element('div','lifecycle-branches');
    branches.append(execution,hookStage('hookMcp',['Elicitation','ElicitationResult'],counts,'hookMcpNote','conditional'));
    cycle.append(permission,flowArrow(),branches,flowArrow(),
      hookStage('hookResults',['PostToolUse','PostToolUseFailure'],counts),
      hookStage('hookBatch',['PostToolBatch'],counts,'hookBatchNote','conditional lifecycle-batch'),
      element('p','lifecycle-repeat',t('hookRepeat')));
    turn.append(cycle,flowArrow(),hookStage('hookFinish',['Stop','StopFailure','Interrupt'],counts,'hookFinishNote','lifecycle-finish'));
    main.append(hookStage('hookSession',['SessionStart'],counts,null,'lifecycle-session'),flowArrow(),turn,
      element('p','lifecycle-repeat',t('hookSessionRepeat')),flowArrow(),
      hookStage('hookSessionEnd',['SessionEnd'],counts,null,'lifecycle-session'));
    const side = element('aside','lifecycle-side');
    side.append(element('h3','lifecycle-region-title',t('hookBranches')),element('p','hook-stage-note',t('hookBranchesNote')));
    HOOK_GROUPS.filter(group => ['team','context','environment','messages'].includes(group.id)).forEach(group => {
      const section = hookStage(group.title,group.hooks,counts,group.note,'conditional');
      section.dataset.group = group.id;
      side.append(section);
    });
    root.append(main,side);
    restoreFocus();
  }

  function render(stats, events, office) {
    const o = stats.overview, game = stats.game;
    $('connection').textContent = t('live');
    $('metrics').replaceChildren();
    [
      [t('events'),number(o.events),number(o.heartbeats) + ' ' + t('heartbeat')],
      [t('turns'),number(o.turns),number(o.sessions) + ' ' + t('sessions')],
      [t('tools'),number(o.tools),number(o.tool_errors) + ' ' + t('errors')],
      [t('active'),duration(o.active_seconds),number(o.transitions) + ' ' + t('transitions')]
    ].forEach(([label,value,note]) => {
      const card = element('div','metric');
      card.append(element('div','metric-label',label),element('div','metric-value',value),element('div','metric-note',note));
      $('metrics').append(card);
    });
    $('board-activity').hidden = !stats.agent_board?.available;
    $('board-activity-metrics').replaceChildren();
    if (stats.agent_board?.available) {
      const summary = stats.agent_board.summary;
      [['messages','boardMessages'],['threads','boardTopics'],['agents','boardAgents'],['channels','boardChannels']].forEach(([key,label]) => {
        const card = element('div','metric');
        card.append(element('div','metric-label',t(label)),element('div','metric-value',number(summary[key] || 0)));
        $('board-activity-metrics').append(card);
      });
    }
    $('level').textContent = 'LV. ' + game.level;
    $('xp-text').textContent = number(game.xp) + ' XP · +' + game.period_xp + ' ' + t('xpPeriod');
    $('level-progress').textContent = game.level_xp + ' / 100 XP';
    $('xp-progress').value = game.level_xp;
    renderAchievements(game.badges);
    renderCollections(game);
    renderExploration(game.exploration);
    $('states').replaceChildren();
    const maximum = Math.max(1,...Object.values(stats.states).map(value => value.count));
    STATES.forEach(state => {
      const v = stats.states[state], row = element('div','state-row'), track = element('div','state-track'), fill = element('div','state-fill');
      fill.style.width = (v.count / maximum * 100) + '%';
      track.append(fill);
      row.append(element('span','',stateLabel(state)),track,element('span','state-value',v.count + ' / ' + duration(v.seconds)));
      $('states').append(row);
    });
    renderHooks(stats.hooks);
    const daily = new Map(stats.daily.map(day => [day.date,day]));
    const end = new Date(stats.until * 1000), start = new Date(Math.max(stats.since * 1000,end.getTime() - 29 * 86400000));
    start.setHours(0,0,0,0);
    const days = [];
    for (let day = new Date(start); day <= end; day.setDate(day.getDate()+1)) {
      const key = day.getFullYear() + '-' + String(day.getMonth()+1).padStart(2,'0') + '-' + String(day.getDate()).padStart(2,'0');
      days.push(daily.get(key) || {date:key,events:0});
    }
    const peak = Math.max(1,...days.map(day => day.events));
    $('daily').replaceChildren(...days.map((day,i) => {
      const column = element('div','day'), bar = element('div','day-fill');
      bar.style.height = Math.max(2,day.events / peak * 130) + 'px';
      column.title = day.date + ': ' + day.events + ' ' + t('events');
      column.setAttribute('aria-label',column.title);
      column.append(bar,element('div','day-label',days.length <= 7 || i % 5 === 0 || i === days.length-1 ? day.date.slice(5) : ''));
      return column;
    }));
    $('details').replaceChildren(...[
      ['permissions',o.permission_requests],['interrupts',o.interrupts],['compactions',o.compactions],['subagents',o.subagents],
      ['sessions',o.sessions],['stateUpdates',o.state_updates],['heartbeat',o.heartbeats],['errors',o.tool_errors]
    ].map(([label,value]) => {
      const box = element('div','detail',t(label)); box.append(element('strong','',number(value))); return box;
    }));
    $('tool-duration').textContent = t('average') + ': ' + (o.average_tool_seconds === null ? '—' : duration(o.average_tool_seconds)) + ' · ' + o.measured_tools + ' ' + t('measured');
    renderActors(stats.actors, office);
    $('event-list').replaceChildren();
    if (!events.length) {
      $('event-list').append(element('div','empty',stats.overview.events ? t('noMatch') : t('empty')));
    }
    events.forEach(event => {
      const row = element('div','event'), time = new Date(event.occurred_at * 1000);
      const body = element('div','event-detail',event.detail);
      body.append(element('div','event-meta',[
        event.actor_name,stateLabel(event.state),event.source,event.heartbeat ? t('heartbeat') : '',
        event.metadata?.observe_only ? t('observed') : !event.applied ? t('late') : ''
      ].filter(Boolean).join(' · ')));
      row.append(element('time','event-time',time.toLocaleDateString() + '\n' + time.toLocaleTimeString()),element('div','event-hook',event.event_name),body);
      $('event-list').append(row);
    });
  }
  async function get(url, signal, requireSuccess = true) {
    const response = await fetch(url,{cache:'no-store',signal});
    const data = await response.json();
    if (!response.ok || (requireSuccess && !data.ok)) throw new Error(data.msg || response.status);
    return data;
  }
  async function refresh() {
    if (controller) controller.abort();
    controller = new AbortController();
    const params = new URLSearchParams({period,limit:'50'});
    if ($('state-filter').value) params.set('state',$('state-filter').value);
    if ($('hook-filter').value) params.set('hook',$('hook-filter').value);
    try {
      const [stats,history,office] = await Promise.all([
        get('/api/stats?period='+period,controller.signal),
        get('/api/events?'+params,controller.signal),
        get('/status',controller.signal,false)
      ]);
      lastData = [stats,history.events,office]; render(...lastData); $('error').hidden = true;
      return true;
    } catch (error) {
      if (error.name === 'AbortError') return false;
      $('error').textContent = t('failed'); $('error').hidden = false;
      $('connection').textContent = t('failed');
      return false;
    }
  }
  document.querySelectorAll('[data-lang]').forEach(button => button.addEventListener('click',() => {
    lang = button.dataset.lang;
    try { localStorage.setItem('uiLang',lang); } catch (_) {}
    translate(); if (lastData) render(...lastData);
  }));
  document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click',() => {
    period = button.dataset.period;
    document.querySelectorAll('[data-period]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
    refresh();
  }));
  document.querySelectorAll('[data-achievement-filter]').forEach(button => button.addEventListener('click',() => {
    achievementFilter = button.dataset.achievementFilter;
    if (lastData) renderAchievements(lastData[0].game.badges);
  }));
  document.querySelectorAll('[data-hook-view]').forEach(button => button.addEventListener('click',() => {
    hookView = button.dataset.hookView;
    try { localStorage.setItem(HOOK_VIEW_STORAGE_KEY,hookView); } catch (_) {}
    if (lastData) renderHooks(lastData[0].hooks);
  }));
  $('achievement-link').addEventListener('click',() => { $('achievements').open = true; });
  $('achievement-goals-link').addEventListener('click',() => {
    $('achievements').open = true;
    achievementFilter = 'repeatable';
    if (lastData) renderAchievements(lastData[0].game.badges);
  });
  $('state-filter').addEventListener('change',refresh); $('hook-filter').addEventListener('change',refresh);
  $('export').addEventListener('click',async () => {
    try {
      const params = new URLSearchParams({period,limit:'200'});
      if ($('state-filter').value) params.set('state',$('state-filter').value);
      if ($('hook-filter').value) params.set('hook',$('hook-filter').value);
      const data = await get('/api/events?'+params);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data.events,null,2)],{type:'application/json'}));
      const link = element('a'); link.href = url; link.download = 'star-office-events.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch (_) { $('error').textContent = t('failed'); $('error').hidden = false; }
  });
  translate(); renderHooks(); refresh();
  setInterval(() => { if (!document.hidden) refresh(); },10000);
  document.addEventListener('visibilitychange',() => { if (!document.hidden) refresh(); });
})();
