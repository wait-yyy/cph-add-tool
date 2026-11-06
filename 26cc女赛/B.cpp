//#include <iostream>
//#include <iomanip> 
//#include <string>
//#include<queue>
//#include <stack>
//#include<deque>
//typedef long long ll;
//const int mod=      ;
//cout<<fixed<<setprecision()<< <<'\n';//小数精度
#include <bits/stdc++.h>
using namespace std;
#define int long long 
void solve(){
	long long n,amx=1,bmx=2,ami=1,bmi=2;
	cin>>n;
	vector<long long>a(n);
	map<long long,long long>mp;
	for(int i=0;i<n;i++){
		cin>>a[i];
		if(mp.count(a[i])){ami=0;bmi=1;}
		mp[a[i]]++;
		if(mp[a[i]]==n){
			cout<<0<<'/'<<1<<' ';
			cout<<0<<'/'<<1<<'\n';
			return;
		}
	}    
	sort(a.begin(),a.end());
	//for(auto i:a){cout<<i<<' ';}cout<<'\n';
	long long c1=a[0]+a[n-1],b=2,aa=1;
	long long l=0,r=n-1,rr=n-1,ll=0;
	while(l<r-1){
		b++;
		if(a[r-1]*b>(c1+a[r-1])){
			c1+=a[r-1];
			aa++;
			r--;
		}
		else {
			c1+=a[l+1];
			l++;
		}
		if(amx*b<bmx*aa){amx=aa;bmx=b;}
		if(ami*b>bmi*aa){ami=aa;bmi=b;}
	}
	c1=a[0]+a[n-1],b=2,aa=1;
	l=0,r=n-1;
	while(l<r-1){
		b++;
		if(a[r-1]*b>(c1+a[r-1])){
			c1+=a[r-1];
			aa++;
			r--;
		}
		else if(rr>r){
			c1-=a[rr];
			aa--;
			rr--;
			b-=2;
		}
		else {
			c1+=a[l+1];
			l++;
		}
		if(amx*b<bmx*aa){amx=aa;bmx=b;}
		if(ami*b>bmi*aa){ami=aa;bmi=b;}
	}
	c1=a[0]+a[n-1],b=2,aa=1;
	l=0,r=n-1;
	while(l<r-1){
		b++;
		if(a[l+1]*b<=(c1+a[l+1])){
			c1+=a[l+1];
			l++;
		}
		else {
			c1+=a[r-1];
			r--;
			aa++;
		}
		if(amx*b<bmx*aa){amx=aa;bmx=b;}
		if(ami*b>bmi*aa){ami=aa;bmi=b;}
	}
	c1=a[0]+a[n-1],b=2,aa=1;
	l=0,r=n-1;
	while(l<r-1){
		b++;
		if(a[l+1]*b<=(c1+a[l+1])){
			c1+=a[l+1];
			l++;
		}
		else if(ll<l){
			c1-=a[ll];
			ll++;
			b-=2;
		}
		else {
			c1+=a[r-1];
			r--;
			aa++;
		}
		if(amx*b<bmx*aa){amx=aa;bmx=b;}
		if(ami*b>bmi*aa){ami=aa;bmi=b;}
	}
	long long gx=gcd(amx,bmx),gi=gcd(ami,bmi);
	cout<<amx/gx<<'/'<<bmx/gx<<' ';
	cout<<ami/gi<<'/'<<bmi/gi<<'\n';
}
signed main(){
	int t=1;
	cin>>t;
	while(t--){
		solve();
	}
	return 0;
}
