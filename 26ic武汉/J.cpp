//   __    __ __    __ __    __
//   \ \  / / \ \  / / \ \  / /
//    \ \/ /   \ \/ /   \ \/ /
//     \  /     \  /     \  /
//     / /      / /      / /
//    /_/      /_/      /_/    ....WAITING
//
#include <bits/extc++.h>
#include <bits/stdc++.h>

#define ll long long
#define int long long
#define endl '\n'
#define all(a) a.begin(), a.end()
#define Map gp_hash_table

using namespace std;
using namespace __gnu_cxx;
using namespace __gnu_pbds;

const ll inf = 0x3f3f3f3f3f3f3f3f;
const ll MOD = 1e9 + 7;
const ll mod = 998244353;
const ll N = 2e5 + 10; // 注意数据范围
const int MAXN = 1000005;

void solve() {
	int n;
	cin>>n;
	vector<int>a(n),b(n);
	for(int i=0;i<n;i++){
		cin>>a[i];
	}
	for(int i=0;i<n;i++)cin>>b[i];
	sort(all(a));sort(all(b));
	
	
}

signed main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);
	int T = 1;
	cin >> T;
	while (T--) solve();
	return 0;
}
