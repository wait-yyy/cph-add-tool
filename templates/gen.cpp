// 数据生成器（造题用）：argv[1] 是 seed，把一组测试数据打到 stdout。
// 调用方：tools/mkdata.ps1（批量造数据）、tools/cp.ps1 stress（对拍）
//
// 规则：
//   1) 数据范围必须和 statement.md 写的完全一致，改一处就两处一起改；
//   2) 多组数据自己控制 T 和总和限制（比如 Σn <= 2e5）；
//   3) 想造边界/极端数据可以按 seed % k 分支，别只靠随机；
//   4) 不要向 stderr 打日志（对拍时不方便区分）。
#include <bits/stdc++.h>
using namespace std;

static mt19937_64 rng;

long long rnd(long long l, long long r) {
    return uniform_int_distribution<long long>(l, r)(rng);
}

int main(int argc, char **argv) {
    unsigned long long seed;
    if (argc > 1) {
        seed = strtoull(argv[1], nullptr, 10);
    } else {
        seed = (unsigned long long)chrono::steady_clock::now().time_since_epoch().count();
    }
    rng.seed(seed);

    // ================= 以下按题目改写 =================
    const int MAXN = 10;        // 本组最大 n
    const long long VMAX = 100; // 权值上限

    int n = (int)rnd(1, MAXN);
    printf("%d\n", n);
    for (int i = 1; i <= n; i++) {
        printf("%lld%c", rnd(1, VMAX), i == n ? '\n' : ' ');
    }
    // ==================================================

    return 0;
}
