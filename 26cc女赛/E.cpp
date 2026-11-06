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
	vector<int>a(n+1);
	for(int i=n;i>0;i--)cin>>a[i];
	int q;
	cin>>q;
	while(q--){
		int x;
		cin>>x;
		vector<int>ans;
		for(int i=1;i<=n;i++){
			array<int,3> w={inf,0,0};
			for(int j:{-1,0,1}){
				w=min(w,{abs(x-a[i]*j),x-a[i]*j,j});
			}
			x=w[1];
			ans.push_back(w[2]);
		}
		if(x!=0){
			cout<<"NO"<<endl;
			continue;
		}
		cout<<"YES"<<endl;
		for(int i=n-1;i>=0;i--)cout<<ans[i]<<" ";
		cout<<endl;
	}
}

signed main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);
	int T = 1;
	cin >> T;
	while (T--) solve();
	return 0;
}
