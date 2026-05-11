Clarity 公网数据导出说明

导出时间: 2026-04-24 Asia/Shanghai
窗口: 最近 3 天
来源: Microsoft Clarity Data Export API

已导出文件:
- 01_overview.json / 01_overview.csv
- 02_by_url.json / 02_by_url.csv
- 03_by_browser.json / 03_by_browser.csv
- 05_by_referrer.json / 05_by_referrer.csv

限制:
- 当前 API 只能拿到聚合分析数据，不提供逐用户会话明细。
- 不能直接导出进入时间、上传文件名、输入值、输出值、下载点击链路等逐步操作级别数据。
- 若要这类数据，需要从 Clarity 后台手动导出录屏/会话数据，或改用你自己的后端埋点。

今天接口已出现 429 限流，所以 Country / Device 维度本次未补齐。