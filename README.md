# 五子棋对战小网页

这是一个纯静态五子棋网页，支持本地双人对战，也支持通过 Supabase Realtime 分享房间在线对战。

## 配置 Supabase

打开 `config.js`，填入你的 Supabase 项目配置：

```js
window.GOMOKU_SUPABASE = {
  url: "https://你的项目.supabase.co",
  anonKey: "你的 anon public key",
};
```

`anon public key` 是公开前端 key，不是 service role key。

## 部署到 Netlify

1. 把项目上传到 GitHub。
2. 在 Netlify 新建站点，选择这个 GitHub 仓库。
3. Build command 留空。
4. Publish directory 填 `.`。
5. 在 Netlify 的 Site settings 里添加环境变量 `DEEPSEEK_API_KEY`。
6. 部署完成后打开站点，先选择“我执黑”或“我执白”，再点击“创建房间”，复制邀请链接给好友。

## AI 对战

点击“AI对战”即可和 AI 下棋。玩家颜色使用“我执黑 / 我执白”的选择。

规则可以选择：

- 自由规则：黑白都没有禁手，五连或以上获胜。
- 禁手规则：黑棋三三、四四、长连判禁手；白棋无禁手。
- 不限时，或者每手 25 秒；倒计时归零时当前应落子的一方判负。

联机悔棋只允许在自己刚落子、对方还没落子时申请。对方同意后，仅撤回申请方刚刚落下的一颗棋。

线上部署后，AI 会通过 Netlify Function 调用 DeepSeek API。需要在 Netlify 添加环境变量：

```text
DEEPSEEK_API_KEY=你的 DeepSeek API Key
```

可选环境变量：

```text
DEEPSEEK_MODEL=deepseek-chat
```

如果本地静态预览没有 Netlify Function，页面会自动使用本地兜底算法落子。

## 本地预览

可以直接双击 `index.html` 玩本地双人模式。

如果要测试联机，建议用一个本地静态服务器打开：

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

然后访问：

```text
http://127.0.0.1:4173/
```
