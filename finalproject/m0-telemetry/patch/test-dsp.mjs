import { fft, spectrum, autocorrPeak, xcorrLag, makeKernel, convolveLatest, BandResynth, Ring, OnePole } from './dsp.js';
let pass=0, fail=0;
const ok=(name,cond,got)=>{ (cond?pass++:fail++); console.log((cond?'  ok  ':'  FAIL'),name, got!==undefined?'-> '+got:''); };
const near=(a,b,tol)=>Math.abs(a-b)<=tol;

// 1 FFT round trip
{ const n=64, re=new Float32Array(n), im=new Float32Array(n), r0=new Float32Array(n);
  for(let i=0;i<n;i++){ re[i]=r0[i]=Math.sin(i*0.37)+0.3*Math.cos(i*1.1); }
  fft(re,im); fft(re,im,true);
  let e=0; for(let i=0;i<n;i++) e=Math.max(e,Math.abs(re[i]-r0[i]));
  ok('FFT forward+inverse is identity', e<1e-4, 'max err '+e.toExponential(2)); }

// 2 FFT finds a known tone
{ const rate=60, n=256, sig=new Float32Array(n);
  for(let i=0;i<n;i++) sig[i]=Math.sin(2*Math.PI*5*i/rate);
  const s=spectrum(sig,rate);
  ok('spectrum peak of a 5 Hz tone is 5 Hz', near(s.peakFreq,5,0.5), s.peakFreq.toFixed(2)+' Hz');
  ok('spectrum flatness of a pure tone is low', s.flatness<0.3, s.flatness.toFixed(3)); }

// 3 white-ish noise is spectrally flat
{ const rate=60, n=512, sig=new Float32Array(n);
  for(let i=0;i<n;i++) sig[i]=Math.random()*2-1;
  const s=spectrum(sig,rate);
  ok('spectrum flatness of noise is high', s.flatness>0.4, s.flatness.toFixed(3)); }

// 4 autocorrelation on a sine of known period
{ const rate=30, n=600, sig=new Float32Array(n);
  for(let i=0;i<n;i++) sig[i]=5+Math.sin(2*Math.PI*i/(4*rate));   // 4 s period, DC offset 5
  const a=autocorrPeak(sig,rate,0.5,20);
  ok('autocorr finds a 4 s sine period despite DC offset', near(a.period,4,0.2), a.period.toFixed(3)+' s, r='+a.strength.toFixed(3)); }

// 5 autocorrelation on a periodic impulse train = the PDF-batch case
{ const rate=30, n=900, sig=new Float32Array(n), P=2.5;
  for(let i=0;i<n;i++) sig[i]= (i % Math.round(P*rate) < 4) ? 1 : 0;   // a burst every 2.5 s
  const a=autocorrPeak(sig,rate,0.5,20);
  ok('autocorr finds the 2.5 s loop of a burst train', near(a.period,P,0.15), a.period.toFixed(3)+' s, r='+a.strength.toFixed(3)); }

// 6 autocorrelation must NOT invent a period in noise
{ const rate=30, n=600, sig=new Float32Array(n);
  for(let i=0;i<n;i++) sig[i]=Math.random();
  const a=autocorrPeak(sig,rate,0.5,20);
  ok('autocorr strength on white noise stays low', a.strength<0.35, 'r='+a.strength.toFixed(3)); }

// 7 cross-correlation lag and sign
{ const rate=30, n=600, D=1.0, a=new Float32Array(n), b=new Float32Array(n);
  for(let i=0;i<n;i++){ a[i]=Math.sin(2*Math.PI*i/(3*rate))+0.1*Math.random(); }
  const d=Math.round(D*rate);
  for(let i=0;i<n;i++) b[i]= i>=d ? a[i-d] : 0;      // b is a delayed by 1 s => a LEADS b
  const x=xcorrLag(a,b,rate,5);
  ok('xcorr recovers a 1.0 s lag', near(Math.abs(x.lag),D,0.12), x.lag.toFixed(3)+' s, r='+x.r.toFixed(3));
  ok('xcorr sign says a leads b (positive)', x.lag>0, x.lag.toFixed(3)); }

// 8 convolution: impulse through a kernel returns the kernel, normalised
{ const k=makeKernel('exp',16);
  let s=0; for(const v of k) s+=v;
  ok('kernel has unity gain', near(s,1,1e-5), s.toFixed(6));
  const sig=new Float32Array(32); sig[31]=1;             // impulse at the newest sample
  ok('convolve of a fresh impulse = kernel[0]', near(convolveLatest(sig,k),k[0],1e-6), convolveLatest(sig,k).toFixed(5));
  const sig2=new Float32Array(32); sig2[28]=1;           // impulse 3 samples ago
  ok('convolve of a 3-old impulse = kernel[3]', near(convolveLatest(sig2,k),k[3],1e-6), convolveLatest(sig2,k).toFixed(5)); }

// 9 STFT -> iSTFT band select keeps the slow component and rejects the fast one.
// Tested on the FREQUENCY of the output, not a phase-locked correlation: a
// full-window STFT delays its output by about one window (here ~17 s), so the
// result is correct but late. That latency is real and matters for any band
// this slow.
{ const rate=60, N=1024, br=new BandResynth(N,rate);
  const n=14000, out=[];
  for(let i=0;i<n;i++){
    const t=i/rate;
    const y=br.process(Math.sin(2*Math.PI*0.2*t) + Math.sin(2*Math.PI*8*t), 0.1, 0.3);
    if(i>=n-4096) out.push(y);
  }
  const sig=Float32Array.from(out);
  const s=spectrum(sig,rate);
  ok('iSTFT output peaks at the passband tone (0.2 Hz)', near(s.peakFreq,0.2,0.05), s.peakFreq.toFixed(4)+' Hz');
  const rej=spectrum(sig,rate,7.5,8.5);
  ok('iSTFT rejects the 8 Hz stopband tone', rej.bandNorm<0.02, 'stopband share '+(rej.bandNorm*100).toFixed(3)+'%');
  let amp=0; for(const v of sig) amp=Math.max(amp,Math.abs(v));
  ok('iSTFT preserves amplitude within 25%', amp>0.75&&amp<1.25, 'peak '+amp.toFixed(3)); }

// 10 Ring ordering
{ const r=new Ring(4); [1,2,3,4,5].forEach(v=>r.push(v));
  const a=Array.from(r.toArray());
  ok('Ring.toArray is oldest-first', JSON.stringify(a)==='[2,3,4,5]', JSON.stringify(a));
  ok('Ring.last is newest', r.last()===5, r.last()); }

// 11 one-pole settles to a step
{ const f=new OnePole(); let y=0;
  for(let i=0;i<600;i++) y=f.process(1,1.0,1/60);
  ok('one-pole settles to a unit step', near(y,1,0.01), y.toFixed(4)); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
