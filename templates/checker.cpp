// 特判（SPJ）模板：checker.exe <input> <answer> <participant_output>
// 返回码：0 = AC，1 = WA，2 = PE，3 = FAIL（checker 自身/参数问题）
//
// 默认行为：把 answer 和 participant_output 按空白切成 token 逐个比较，
//          忽略行尾空白/多余换行（普通题的答案比较就够用）。
// 需要特判时改 compareTokens：
//   - 浮点误差：用 err = 1e-6，|a-b| <= err * max(1, |a|)
//   - 任意合法解：用 input 重新验证 participant_output 的可行性
//   - 多解/构造题：验证约束 + 目标值
#include <bits/stdc++.h>
using namespace std;

static vector<string> readTokens(const char *path, bool &ok) {
    ifstream f(path);
    ok = false;
    if (!f.is_open()) return {};
    vector<string> v;
    string s;
    while (f >> s) v.push_back(s);
    ok = true;
    return v;
}

int main(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: checker.exe <input> <answer> <output>\n");
        return 3;
    }
    bool okAns = false, okOut = false;
    vector<string> ans = readTokens(argv[2], okAns);
    vector<string> out = readTokens(argv[3], okOut);
    if (!okAns) { fprintf(stderr, "checker: cannot open answer file\n"); return 3; }
    if (!okOut) { fprintf(stderr, "checker: cannot open output file\n"); return 3; }

    if (ans.size() != out.size()) {
        printf("wrong answer: token count %zu, expected %zu\n", out.size(), ans.size());
        return 1;
    }
    for (size_t i = 0; i < ans.size(); i++) {
        bool same = (ans[i] == out[i]);
        // ---- 浮点特判示例 ----
        // const double eps = 1e-6;
        // double x = stod(ans[i]), y = stod(out[i]);
        // same = fabs(x - y) <= eps * max(1.0, fabs(x));
        if (!same) {
            printf("wrong answer: token %zu: expected '%s', found '%s'\n",
                   i + 1, ans[i].c_str(), out[i].c_str());
            return 1;
        }
    }
    return 0;
}
