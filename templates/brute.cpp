// 暴力/朴素解（造题对拍用）：stdin 输入格式必须和 sol.cpp 一致，答案写到 stdout。
// 允许很慢，只要在数据范围内跑得动（mkdata 默认给暴力 20x 时限）。
// 用途：mkdata 用暴力答案校验标解；cp.ps1 stress 用暴力当"标准答案"找标解反例。
#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    if (scanf("%d", &n) != 1) return 0;
    vector<long long> a(n + 1);
    for (int i = 1; i <= n; i++) {
        if (scanf("%lld", &a[i]) != 1) return 0;
    }

    // ================= 以下按题目改写（示例：最大子段和 O(n^2)） =================
    long long ans = LLONG_MIN;
    for (int l = 1; l <= n; l++) {
        long long sum = 0;
        for (int r = l; r <= n; r++) {
            sum += a[r];
            ans = max(ans, sum);
        }
    }
    printf("%lld\n", ans);
    // ==========================================================================

    return 0;
}
