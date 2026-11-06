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
	int n,m,id=0,X=0;
	cin>>n>>m;
	vector<int>a(n+1);
	for(int i=1;i<=n;i++){
		cin>>a[i];
		if(a[i]==0){
			id=i;
		}
	}
	vector<vector<int>>e(n+1),ans(n+1);
	for(int i=1;i<=n;i++){
		int x;
		cin>>x;
		for(int j=0;j<x;j++){
			int y;
			cin>>y;
			e[i].push_back(y);
		}
	}
//	for(int i=1;i<=n;i++){
//		for(auto j:e[i]){
//			cout<<j<<" ";
//		}cout<<endl;
//	}
	vector<bool>vis(n+1,false);
	queue<int>q;
	q.push(id);
	vis[id]=true;
	while(q.size()){
		auto x=q.front();
		int cnt=1;
		q.pop();
		vector<int>v,w=e[x];
		while(w.size()){
			vector<int>r;
			for(auto i:w){
				if(vis[i]==false){
					vis[i]=true;
					q.push(i);
				}
				if(a[x]+cnt==a[i]){
					ans[x].push_back(i);
				}else if(a[x]+cnt>a[i])v.push_back(i);
				else r.push_back(i);
			}
			w=r;
			cnt++;
		}
		for(auto i:v)ans[x].push_back(i);
	}
	for(int i=1;i<=n;i++){
		if(ans[i].size()!=e[i].size()){
			cout<<-1<<endl;
			return;
		}
	}
	cout<<id<<endl;
	for(int i=1;i<=n;i++){
		for(auto j:ans[i]){
			cout<<j<<" ";
		}cout<<endl;
	}
}

signed main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);
	int T = 1;
	//cin >> T;
	while (T--) solve();
	return 0;
}	
