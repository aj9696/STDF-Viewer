// Only UI-owned strings are passed here. Source names, fields, filenames and
// freeform input must never be translated by matching their text in the DOM.
let locale = 'en';
const rows = `
Tools|도구|工具
Choose a tool…|도구 선택…|选择工具…
Overview|개요|概览
Files / lots|파일 / 로트|文件 / 批次
Compare distributions|분포 비교|分布比较
Scatter 2D / 3D|2D / 3D 산점도|2D / 3D 散点图
Wafer values / 3D|웨이퍼 값 / 3D|晶圆数值 / 3D
Wafer gallery|웨이퍼 갤러리|晶圆图库
PAT by lot|로트별 PAT|按批次 PAT
GDBN / cluster detection|GDBN / 클러스터 검출|GDBN / 聚类检测
Combined screening|복합 스크리닝|组合筛选
What-If limits|가상 한계값|假设限值
PVT corners|PVT 코너|PVT 条件
Gauge R&R|게이지 R&R|量具 R&R
Edit / convert|편집 / 변환|编辑 / 转换
Reports|보고서|报告
Action|작업|操作
Add / remove records|레코드 추가 / 삭제|添加 / 删除记录
Add lot|로트 추가|添加批次
Affected devices|영향받는 디바이스|受影响器件
After|변경 후|修改后
All|전체|全部
Attempt PIR sequence|시도 PIR 순번|测试记录的 PIR 序号
Batch conversion|일괄 변환|批量转换
Before|변경 전|修改前
Bin|빈|分档
Bin family|빈 종류|分档类别
Bin number|빈 번호|分档编号
Bin outcome|빈 판정|分档结果
Bins|빈|分档
Box / whiskers|상자 / 수염|箱线图
Bytes|바이트|字节
Calculate Gauge R&R|게이지 R&R 계산|计算量具 R&R
Cancel|취소|取消
Cluster detection|클러스터 검출|聚类检测
Compare|비교|比较
Compare corners|코너 비교|比较条件
Compare differently named tests|다른 이름의 테스트 비교|比较不同名称的测试
Complete records JSON|전체 레코드 JSON|完整记录 JSON
Completed file|완료된 파일|已完成文件
Component|성분|分量
Connectivity|연결 방식|连通方式
Create report|보고서 생성|生成报告
Current comparison|현재 비교|当前比较
Datalog note|데이터 로그 메모|数据日志备注
Delete record sequence|삭제할 레코드 순번|待删除记录序号
Density weights|밀도 가중치|密度权重
Derived copies|파생 복사본|派生副本
Design CSV|실험 설계 CSV|实验设计 CSV
Device|디바이스|器件
Device / contributors|디바이스 / 기여 항목|器件 / 贡献项
Device / measurement CSV|디바이스 / 측정값 CSV|器件 / 测量值 CSV
Device correlation|디바이스 상관관계|器件相关性
Devices|디바이스|器件
Die values|다이 값|芯片数值
Dimensions|차원|维度
Distance weighted|거리 가중|距离加权
Download|다운로드|下载
Download mapping template|매핑 양식 다운로드|下载映射模板
Download receipt|처리 내역 다운로드|下载处理清单
Each lot|각 로트|每个批次
Each source|각 소스|每个源文件
Each source and each lot|각 소스 및 각 로트|每个源文件和每个批次
Edit fields / results|필드 / 결과 편집|编辑字段 / 结果
Edit plan JSON|편집 계획 JSON|编辑方案 JSON
Editing policy|편집 정책|编辑规则
Empirical CDF|경험적 CDF|经验 CDF
Exclude from PAT|PAT에서 제외|从 PAT 排除
Exempt bins (comma separated)|제외할 빈 (쉼표 구분)|豁免分档（逗号分隔）
Export derived STDF|파생 STDF 내보내기|导出派生 STDF
Export receipt|내보내기 처리 내역|导出处理清单
Export screened copy…|스크리닝 복사본 내보내기…|导出筛选副本…
Fail|불합격|失败
Fail bins|불합격 빈|失败分档
Fail fraction|불합격 비율|失败比例
Failed executions|불합격 실행|失败测试次数
Failing devices|불합격 디바이스|失败器件
Failing neighbors|불합격 인접 다이|失败邻近芯片
Failure bin|불합격 빈|失败分档
Failure bins by file / lot|파일 / 로트별 불합격 빈|按文件 / 批次的失败分档
Field|필드|字段
Field changes|필드 변경|字段修改
File|파일|文件
File and lot comparison|파일 및 로트 비교|文件与批次比较
Find saved ATDF|저장된 ATDF 찾기|查找已保存的 ATDF
First matching rule wins|첫 일치 규칙 우선|首个匹配规则优先
Fit|피팅|拟合
Format|형식|格式
Formats|형식|格式
From bin|원래 빈|原分档
Generate conversion|변환 실행|执行转换
Generate screened copies|스크리닝 복사본 생성|生成筛选副本
Good die / bad neighborhood|정상 다이 / 불량 이웃|良品芯片 / 不良邻域
Group|그룹|分组
Group by|그룹 기준|分组依据
Hardware|하드웨어|硬件
Hardware bin|하드웨어 빈|硬件分档
Head|테스트 헤드|测试头
Head / site|헤드 / 사이트|测试头 / 测试站点
High limit|상한|上限
Histogram|히스토그램|直方图
Import ATDF|ATDF 가져오기|导入 ATDF
Import receipt|가져오기 처리 내역|导入处理清单
In limits|한계 내|限值内
Inserted / deleted records|추가 / 삭제 레코드|新增 / 删除的记录
Keep recorded outcome|기록된 판정 유지|保留记录结果
Latest coordinate values|최신 좌표 값|最新坐标数值
Load lot recipes|로트 설정 불러오기|加载批次配方
Lot|로트|批次
Lot name|로트 이름|批次名称
Low limit|하한|下限
Lower limit|하한|下限
Map|맵|图
Mean|평균|均值
Mean / sample SD|평균 / 표본 표준편차|均值 / 样本标准差
Mean / sample sigma|평균 / 표본 시그마|均值 / 样本标准差
Mean at matching coordinates|동일 좌표 평균|相同坐标均值
Mean time (ms)|평균 시간 (ms)|平均时间（ms）
Median / 1.4826 MAD|중앙값 / 1.4826 MAD|中位数 / 1.4826 MAD
Median / MAD|중앙값 / MAD|中位数 / MAD
Method & provenance|방법 및 출처|方法与来源
Minimum cluster|최소 클러스터|最小聚类
Multiplier|배수|倍数
Name / note|이름 / 메모|名称 / 备注
New outcome|새 판정|新结果
New value|새 값|新值
None|선택 안 함|全不选
Note|메모|备注
One lot|한 로트|单个批次
Open edit plan|편집 계획 열기|打开编辑方案
Open wafer|웨이퍼 열기|打开晶圆
Operation|작업|操作
Original ATDF|원본 ATDF|原始 ATDF
Original PIR|원본 PIR|原始 PIR
Original STDF|원본 STDF|原始 STDF
Original input|원본 입력|原始输入
PAT failure bin|PAT 불합격 빈|PAT 失败分档
PAT fit|PAT 피팅|PAT 拟合
PAT multiplier|PAT 배수|PAT 倍数
PAT options|PAT 옵션|PAT 选项
PAT reference groups (optional)|PAT 기준 그룹 (선택)|PAT 参考分组（可选）
PVT response|PVT 응답|PVT 响应
Page layout|페이지 배치|页面布局
Page width (mm)|페이지 너비 (mm)|页面宽度（mm）
Page height (mm)|페이지 높이 (mm)|页面高度（mm）
Image width (pixels)|이미지 너비 (픽셀)|图像宽度（像素）
Pages|페이지|页数
Paired devices|짝지어진 디바이스|配对器件
Pass|합격|通过
Pass / fail|합격 / 불합격|通过 / 失败
Plot|그래프|图表
Plot correlation|상관관계 그리기|绘制相关性
Population|모집단|总体
Preview combined screening|복합 스크리닝 미리보기|预览组合筛选
Preview lot PAT|로트 PAT 미리보기|预览批次 PAT
Preview revision|수정 미리보기|预览修改
Preview screening|스크리닝 미리보기|预览筛选
Preview wafer changes|웨이퍼 변경 미리보기|预览晶圆变化
Process corner|공정 코너|工艺角
Projected|예상|预计
Provenance|출처|来源
Quartiles and Tukey whiskers|사분위수 및 Tukey 수염|四分位数和 Tukey 须线
Radius|반경|半径
Read record|레코드 읽기|读取记录
Reason|이유|原因
Receipt JSON|처리 내역 JSON|处理清单 JSON
Record|레코드|记录
Record sequence|레코드 순번|记录序号
Record type|레코드 종류|记录类型
Recorded fields|기록된 필드|已记录字段
Recover original ATDF|원본 ATDF 복구|恢复原始 ATDF
Reference groups (comma separated)|기준 그룹 (쉼표 구분)|参考分组（逗号分隔）
Reference population|기준 모집단|参考总体
Remap bins|빈 재매핑|重新分配分档
Remove device attempts|디바이스 시도 삭제|删除器件测试记录
Remove lot|로트 삭제|删除批次
Result ordinal|결과 인덱스|结果索引
Revert draft|초안 되돌리기|撤销草稿
Revision reason|수정 이유|修改原因
Rule|규칙|规则
Rule summaries|규칙 요약|规则汇总
Save edit plan|편집 계획 저장|保存编辑方案
Save lot recipes|로트 설정 저장|保存批次配方
Save result & recipe|결과 및 설정 저장|保存结果与配方
Scope|범위|范围
Screening decisions|스크리닝 판정|筛选判定
Screening method|스크리닝 방법|筛选方法
Sections|섹션|章节
Show wafers|웨이퍼 표시|显示晶圆
Sigma|시그마|标准差
Single source|단일 소스|单个源文件
Site|사이트|测试站点
Sites|사이트|测试站点
Size KiB|크기 KiB|大小 KiB
Software|소프트웨어|软件
Software bin|소프트웨어 빈|软件分档
Sort|정렬|排序
Source|소스|源文件
Source details & timing|소스 세부 정보 및 시간|源文件详情与时间
Sources|소스|源文件
Stage attempt removal|시도 삭제 준비|暂存测试记录删除
Stage change|변경 준비|暂存修改
Stage deletion|삭제 준비|暂存删除
Stage new record|새 레코드 준비|暂存新记录
Status|상태|状态
Temperature (°C)|온도 (°C)|温度（°C）
Test|테스트|测试
Test fail bin|테스트 불합격 빈|测试失败分档
Test fail bin (optional)|테스트 불합격 빈 (선택)|测试失败分档（可选）
Test yield|테스트 수율|测试良率
Timestamp UTC offset (minutes)|타임스탬프 UTC 오프셋 (분)|时间戳 UTC 偏移（分钟）
Title|제목|标题
To bin|대상 빈|目标分档
Tolerance width (optional)|공차 폭 (선택)|公差宽度（可选）
Top failing tests|주요 불합격 테스트|主要失败测试
UTC offset|UTC 오프셋|UTC 偏移
Undo|실행 취소|撤销
Uniform|균일|均匀
Unknown|알 수 없음|未知
Upper limit|상한|上限
Validate plan|계획 검증|验证方案
Value|값|数值
Value distribution|값 분포|数值分布
Values|값|数值
Voltage (V)|전압 (V)|电压（V）
Wafer|웨이퍼|晶圆
Wafer preview|웨이퍼 미리보기|晶圆预览
Weighted aggregate yield|가중 전체 수율|加权总体良率
X test|X 테스트|X 测试
Y test|Y 테스트|Y 测试
Yield|수율|良率
Yield by population|모집단별 수율|按总体的良率
Z test|Z 테스트|Z 测试
3D values|3D 값|3D 数值
4 neighbors|인접 다이 4개|4 个邻点
8 neighbors|인접 다이 8개|8 个邻点
fit|피팅|拟合
multiplier|배수|倍数
failure bin|불합격 빈|失败分档
reference groups (optional)|기준 그룹 (선택)|参考分组（可选）
Each group independently|그룹별 독립 적용|各分组独立处理
Reference N|기준 표본 수|参考样本数
Center|중심|中心
Spread|산포|离散度
Eligible|적격|符合条件
Excluded|제외됨|已排除
Flagged|표시됨|已标记
Minimum|최솟값|最小值
Maximum|최댓값|最大值
Median|중앙값|中位数
Lower whisker|하단 수염|下须
Upper whisker|상단 수염|上须
Outliers|이상치|离群值
Coordinates|좌표|坐标
Valid|유효|有效
Invalid|무효|无效
Missing|누락|缺失
Outside limits|한계 밖|超出限值
Mean yield|평균 수율|平均良率
Mean time|평균 시간|平均时间
Wafers|웨이퍼|晶圆
PNG pages|PNG 페이지|PNG 页面
JPEG pages|JPEG 페이지|JPEG 页面
Selected test statistics|선택한 테스트 통계|所选测试统计
File summary|파일 요약|文件汇总
Histograms|히스토그램|直方图
Test-order trends|테스트 순서 추세|测试顺序趋势
Bin charts|빈 차트|分档图表
Wafer maps|웨이퍼 맵|晶圆图
PAT screening|PAT 스크리닝|PAT 筛选
Lowest-Cpk histograms|최저 Cpk 히스토그램|最低 Cpk 直方图
Device yield / time trends|디바이스 수율 / 시간 추세|器件良率 / 时间趋势
Site summary|사이트 요약|测试站点汇总
Retest counts|재검사 횟수|复测次数
Original PCR counts|원본 PCR 집계|原始 PCR 计数
Datalog notes|데이터 로그 메모|数据日志备注
Previous page|이전 페이지|上一页
Next page|다음 페이지|下一页
Reset view|보기 초기화|重置视图
Test for|테스트 대상|测试对应
Use an explicit test for each group|그룹별 테스트를 직접 지정|为每个分组指定测试
Save settings|설정 저장|保存设置
Navigation language|탐색 언어|导航语言
Display|표시|显示
STDF + CSV + JSON ZIP|STDF + CSV + JSON ZIP|STDF + CSV + JSON ZIP
ATDF file|ATDF 파일|ATDF 文件
Dashboard|대시보드|仪表盘
Compare files / lots|파일 / 로트 비교|比较文件 / 批次
Study|분석|分析
Convert|변환|转换
Open imported data|가져온 데이터 열기|打开导入数据
Enable|활성화|启用
Minimum known neighbors|알려진 인접 다이 최소 수|最少已知邻点数
Population rank (lowest yield first)|모집단 순위 (낮은 수율부터)|总体排名（良率由低到高）
Yield (%)|수율 (%)|良率（%）
Test value|테스트 값|测试值
Cumulative fraction|누적 비율|累计比例
Mean test value|평균 테스트 값|平均测试值
Die X|다이 X|芯片 X
Die Y|다이 Y|芯片 Y
Excel summary|Excel 요약|Excel 汇总
Word layout|Word 배치|Word 布局
Summary and source information|요약 및 소스 정보|汇总与源文件信息
Selected test statistics and Cpk ranking|선택한 테스트 통계 및 Cpk 순위|所选测试统计与 Cpk 排名
Test order trends|테스트 순서 추세|测试顺序趋势
Hardware and software bins|하드웨어 및 소프트웨어 빈|硬件与软件分档
Site yield and test time|사이트별 수율 및 테스트 시간|测试站点良率与测试时间
Device yield and test time trends|디바이스 수율 및 테스트 시간 추세|器件良率与测试时间趋势
Recorded part count summaries|기록된 디바이스 수 요약|记录的器件数量汇总
Full catalogue worst Cpk histograms (scan all tests)|전체 목록 최저 Cpk 히스토그램 (모든 테스트 검사)|完整目录最低 Cpk 直方图（扫描所有测试）
Histogram bins|히스토그램 구간 수|直方图分箱数
Displayed decimal precision|표시 소수 자릿수|显示小数位数
Trend point size|추세 그래프 점 크기|趋势点大小
Low-Cpk warning threshold|낮은 Cpk 경고 기준|低 Cpk 警告阈值
Show test limits|테스트 한계 표시|显示测试限值
Show specification limits|규격 한계 표시|显示规格限值
Show mean|평균 표시|显示均值
Show median|중앙값 표시|显示中位数
Show ±3/6/9 sigma|±3/6/9 시그마 표시|显示 ±3/6/9 标准差
Show peak-scaled Gaussian|최댓값에 맞춘 정규 곡선 표시|显示峰值缩放正态曲线
Display font|표시 글꼴|显示字体
Your local font|로컬 글꼴|本地字体
Number notation|숫자 표기|数值格式
Adaptive|자동|自动
Fixed decimal|고정 소수점|固定小数
Scientific|과학 표기|科学计数
Add a local TTF or OTF font (up to 10 MiB)|로컬 TTF 또는 OTF 글꼴 추가 (최대 10 MiB)|添加本地 TTF 或 OTF 字体（最多 10 MiB）
Site and bin colors|사이트 및 빈 색상|测试站点与分档颜色
Color category|색상 종류|颜色类别
Site (-1 for aggregate)|사이트 (전체 집계: -1)|测试站点（汇总为 -1）
Site or bin number|사이트 또는 빈 번호|测试站点或分档编号
Color|색상|颜色
Set color|색상 지정|设置颜色
Palette preset|색상 사전 설정|预设配色
Classic|기본|经典
Blue / orange|파랑 / 주황|蓝色 / 橙色
Grayscale|회색조|灰度
Apply palette|색상표 적용|应用配色
Reset all colors|모든 색상 초기화|重置所有颜色
Wafer direction|웨이퍼 방향|晶圆方向
As recorded|기록대로|按记录
Right / down|오른쪽 / 아래|右 / 下
Right / up|오른쪽 / 위|右 / 上
Left / down|왼쪽 / 아래|左 / 下
Left / up|왼쪽 / 위|左 / 上
Table|표|表格
Test time|테스트 시간|测试时间
Test numbers|테스트 번호|测试编号
Raw device flags|원본 디바이스 플래그|原始器件标志
Units with values|값에 단위 표시|数值显示单位
Fit columns to content|내용에 열 너비 맞춤|按内容调整列宽
Applied limits at each value|각 값에 적용된 한계|每个数值的适用限值
Highlight out-of-limit values|한계 밖 값 강조|突出显示超限值
Limit and unit rows|한계 및 단위 행|限值与单位行
Min / max / mean / sigma rows|최솟값 / 최댓값 / 평균 / 시그마 행|最小值 / 最大值 / 均值 / 标准差行
Cp / Cpk rows|Cp / Cpk 행|Cp / Cpk 行
Fail / yield / count rows|불합격 / 수율 / 수량 행|失败 / 良率 / 数量行
Row density|행 밀도|行密度
Compact|좁게|紧凑
Normal|보통|正常
Comfortable|넓게|宽松
Unit format|단위 형식|单位格式
Engineering prefixes|공학 접두어|工程前缀
Outcome and yield colors|판정 및 수율 색상|结果与良率颜色
Color wafer tiles by yield|수율에 따라 웨이퍼 색상 지정|按良率为晶圆图着色
Yield ≥ (%)|수율 ≥ (%)|良率 ≥（%）
Yield tier color|수율 구간 색상|良率区间颜色
Hide tests|테스트 숨기기|隐藏测试
Apply display exclusions|표시 제외 적용|应用显示排除
No limits|한계 없음|无限值
Constant value|고정 값|恒定值
Never judged|판정 없음|未判定
Name contains (comma-separated)|이름에 포함 (쉼표 구분)|名称包含（逗号分隔）
Preview test exclusions|테스트 제외 미리보기|预览测试排除
Settings|설정|设置
Close|닫기|关闭
mean|평균|均值
stdev|시그마|标准差
testYield|테스트 수율|测试良率
Slope|기울기|斜率
Intercept|절편|截距
Process|공정|工艺
Voltage|전압|电压
Temperature|온도|温度
Min|최솟값|最小值
Max|최댓값|最大值
Variance|분산|方差
Standard deviation|표준편차|标准差
Study variation|연구 변동|研究变差
Percent contribution|기여율|贡献率
Percent study variation|연구 변동 비율|研究变差百分比
Percent tolerance|공차 비율|公差百分比
`;
export const UI_MESSAGES = Object.freeze(Object.fromEntries(rows.trim().split('\n').map(row => {
  const [key, ko, zh] = row.split('|'); return [key, Object.freeze({ ko, zh })];
})));
export function setUiLocale(value = 'en') { locale = ['en','ko','zh'].includes(value) ? value : 'en'; }
export function tr(label, language = locale) { return language === 'en' ? label : UI_MESSAGES[label]?.[language] ?? label; }
/** Use only with an explicit list of UI options, never source/test/lot choices. */
export function uiChoices(choices) { return choices.map(([value, label]) => [value, tr(label)]); }
