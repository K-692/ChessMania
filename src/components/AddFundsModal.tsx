import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { X, CreditCard, Globe, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';

interface AddFundsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface CoinPack {
  id: string;
  coins: number;
  basePriceINR: number;
  discountRate: string;
  finalPriceINR: number;
  imagePath: string;
}

export const COIN_PACKS: CoinPack[] = [
  { id: 'pack_100', coins: 100, basePriceINR: 20, discountRate: '55% OFF', finalPriceINR: 9, imagePath: '/coin_pack/100 coins.png' },
  { id: 'pack_1000', coins: 1000, basePriceINR: 165, discountRate: '40% OFF', finalPriceINR: 99, imagePath: '/coin_pack/1K-5K coins.png' },
  { id: 'pack_5000', coins: 5000, basePriceINR: 640, discountRate: '30% OFF', finalPriceINR: 449, imagePath: '/coin_pack/1K-5K coins.png' },
  { id: 'pack_10000', coins: 10000, basePriceINR: 1285, discountRate: '30% OFF', finalPriceINR: 899, imagePath: '/coin_pack/10K coins.png' },
  { id: 'pack_25000', coins: 25000, basePriceINR: 2855, discountRate: '30% OFF', finalPriceINR: 1999, imagePath: '/coin_pack/25K coins.png' },
  { id: 'pack_50000', coins: 50000, basePriceINR: 5555, discountRate: '28% OFF', finalPriceINR: 3999, imagePath: '/coin_pack/50K coins.png' },
  { id: 'pack_100000', coins: 100000, basePriceINR: 9999, discountRate: '30% OFF', finalPriceINR: 6999, imagePath: '/coin_pack/100K coins.png' },
  { id: 'pack_250000', coins: 250000, basePriceINR: 18570, discountRate: '30% OFF', finalPriceINR: 12999, imagePath: '/coin_pack/250K coins.png' },
  { id: 'pack_500000', coins: 500000, basePriceINR: 30768, discountRate: '35% OFF', finalPriceINR: 19999, imagePath: '/coin_pack/500K coins.png' }
];

export const CURRENCIES = {
  INR: { symbol: '₹', code: 'INR', name: 'Indian Rupee' },
  USD: { symbol: '$', code: 'USD', name: 'US Dollar' },
  EUR: { symbol: '€', code: 'EUR', name: 'Euro' },
  GBP: { symbol: '£', code: 'GBP', name: 'British Pound' }
};

export const CONVERSION_RATES = {
  INR: 1.0,
  USD: 95.4,
  EUR: 110.0,
  GBP: 127.7
};

type CurrencyCode = keyof typeof CURRENCIES;

const convertPrice = (priceINR: number, currency: CurrencyCode): number => {
  const rate = CONVERSION_RATES[currency] || 1.0;
  return Math.round((priceINR / rate) * 100) / 100;
};

export const AddFundsModal: React.FC<AddFundsModalProps> = ({ isOpen, onClose }) => {
  const { user, profile, refetchProfile } = useAuth();
  const [selectedPack, setSelectedPack] = useState<CoinPack>(COIN_PACKS[1]); // default to 1,000 coins
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('INR');
  const [dailySpend, setDailySpend] = useState<number>(0);
  const [checkoutStep, setCheckoutStep] = useState<'selection' | 'checkout' | 'processing' | 'success'>('selection');
  const [isRazorpaySdkLoaded, setIsRazorpaySdkLoaded] = useState(false);
  const [razorpayError, setRazorpayError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successTxId, setSuccessTxId] = useState('');

  // 1. Detect region based on timezone & locale
  useEffect(() => {
    if (!isOpen) return;

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const lang = navigator.language || '';
      
      if (tz.includes('Kolkata') || tz.includes('Calcutta') || lang.includes('IN')) {
        setCurrencyCode('INR');
      } else if (tz.includes('London') || lang.includes('GB')) {
        setCurrencyCode('GBP');
      } else if (tz.includes('Europe') || lang.includes('FR') || lang.includes('DE') || lang.includes('IT') || lang.includes('ES')) {
        setCurrencyCode('EUR');
      } else {
        setCurrencyCode('USD');
      }
    } catch (e) {
      console.warn("Failed to detect region timezone:", e);
      setCurrencyCode('INR'); // Default fallback
    }
  }, [isOpen]);

  // 2. Fetch daily spend logs to calculate the 40,000 spend cap
  const fetchDailySpend = async () => {
    if (!user) return;
    try {
      const now = new Date();
      // Set to midnight today (local timezone)
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

      const q = query(
        collection(db, 'transactions'),
        where('userId', '==', user.uid),
        where('type', '==', 'coinPack')
      );

      const querySnap = await getDocs(q);
      let sum = 0;
      querySnap.forEach((docSnap) => {
        const data = docSnap.data();
        const createdAt = data.createdAt;
        if (typeof createdAt === 'number' && createdAt >= startOfDay) {
          if (typeof data.pricePaidINR === 'number') {
            sum += data.pricePaidINR;
          } else if (typeof data.pricePaid === 'number') {
            sum += data.pricePaid;
          }
        }
      });
      setDailySpend(sum);
    } catch (err) {
      console.error('Error fetching daily spend:', err);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      fetchDailySpend();
    }
  }, [isOpen, user]);

  // 3. Load Razorpay SDK dynamically when the modal is opened
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    setIsRazorpaySdkLoaded(false);
    setRazorpayError(null);

    const loadSDK = () => {
      const existingScript = document.getElementById('razorpay-sdk-script') as HTMLScriptElement | null;
      if (existingScript && (window as any).Razorpay) {
        if (isMounted) setIsRazorpaySdkLoaded(true);
        return;
      }

      const script = document.createElement('script');
      script.id = 'razorpay-sdk-script';
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => {
        if (isMounted) setIsRazorpaySdkLoaded(true);
      };
      script.onerror = () => {
        if (isMounted) setRazorpayError('Failed to load Razorpay secure payment gateway script.');
      };
      document.body.appendChild(script);
    };

    loadSDK();

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  const initiatePayment = async () => {
    if (!user || !profile) return;
    setErrorMessage('');
    setCheckoutStep('processing');

    try {
      // 1. Call Express backend to create a Razorpay order
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
      const response = await fetch(`${apiBaseUrl}/api/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          packId: selectedPack.id,
          currency: currencyCode,
          userId: user.uid
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to create payment order.');
      }

      const order = await response.json();

      // 2. Open Razorpay Checkout widget
      const razorpayKeyId = import.meta.env.VITE_RAZORPAY_KEY_ID;
      if (!razorpayKeyId) {
        throw new Error('Razorpay Key ID is not configured in frontend environment.');
      }

      const options = {
        key: razorpayKeyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Check & Mate',
        description: `Purchase of ${selectedPack.coins.toLocaleString()} Chess Coins`,
        image: `${window.location.origin}/game_logo.png`,
        order_id: order.id,
        prefill: {
          email: user.email || ''
        },
        notes: {
          user_id: user.uid,
          pack_id: selectedPack.id,
          coins: selectedPack.coins.toString()
        },
        handler: async (res: any) => {
          const paymentId = res.razorpay_payment_id;
          const orderId = res.razorpay_order_id;
          const signature = res.razorpay_signature;

          console.log(`Payment captured on client side: ${paymentId}. Verifying payment signature...`);
          setCheckoutStep('processing');

          try {
            const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
            const verifyResponse = await fetch(`${apiBaseUrl}/api/verify-payment`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                razorpay_order_id: orderId,
                razorpay_payment_id: paymentId,
                razorpay_signature: signature
              })
            });

            if (!verifyResponse.ok) {
              const errData = await verifyResponse.json();
              throw new Error(errData.error || 'Payment verification failed.');
            }

            const verifyResult = await verifyResponse.json();
            if (verifyResult.status === 'success') {
              setSuccessTxId(paymentId);
              await refetchProfile();
              setCheckoutStep('success');
            } else {
              throw new Error('Payment verification returned an unsuccessful status.');
            }
          } catch (err: any) {
            console.error('Verification error:', err);
            setErrorMessage(err.message || 'Payment verification failed. If coins are not credited shortly, please contact support.');
            setCheckoutStep('checkout');
          }
        },
        modal: {
          ondismiss: () => {
            // If user closes Razorpay modal, return to checkout step
            setCheckoutStep('checkout');
          }
        },
        theme: {
          color: '#f59e0b'
        }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();

    } catch (err: any) {
      console.error('Checkout error:', err);
      setErrorMessage(err.message || 'An error occurred while initiating the checkout.');
      setCheckoutStep('checkout');
    }
  };

  if (!isOpen) return null;

  const currentCurrency = CURRENCIES[currencyCode];
  const isCapExceeded = dailySpend + selectedPack.finalPriceINR > 40000;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm px-4">
      <div className="glass max-w-2xl w-full rounded-2xl border border-white/10 p-6 shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden text-left animate-fade-in">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-amber-500/10 rounded-xl border border-amber-500/20 flex items-center justify-center w-9 h-9">
              <img src="/coin_pack/100 coins.png" alt="Coins" className="w-5 h-5 object-contain" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Add Funds</h3>
              <p className="text-xs text-slate-400">Select a coins pack to top up your balance</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Dynamic content wrapper with scrolling if contents run long */}
        <div className="flex-grow overflow-y-auto pr-1 space-y-4">
          
          {checkoutStep === 'selection' && (
            <>
              {/* Region / Currency Selection Selector */}
              <div className="flex items-center justify-between bg-slate-900/60 border border-white/5 p-4 rounded-xl">
                <div className="flex items-center space-x-2 text-slate-300">
                  <Globe className="w-4 h-4 text-violet-400" />
                  <span className="text-xs font-semibold">Geographical Currency:</span>
                </div>
                <div className="relative inline-block text-left">
                  <select
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value as CurrencyCode)}
                    className="appearance-none bg-slate-950/80 border border-white/10 rounded-lg pl-3 pr-8 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500 cursor-pointer font-medium"
                  >
                    {Object.values(CURRENCIES).map((cur) => (
                      <option key={cur.code} value={cur.code}>
                        {cur.name} ({cur.symbol})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Daily Spending Cap Progress */}
              <div className="bg-slate-900/30 border border-white/5 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">Daily Spend Limit Cap:</span>
                  <span className="font-mono font-bold text-slate-300">
                    {currentCurrency.symbol}{dailySpend.toLocaleString()} / {currentCurrency.symbol}40,000
                  </span>
                </div>
                <div className="w-full bg-slate-950/80 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      dailySpend >= 40000 ? 'bg-red-500' : dailySpend > 30000 ? 'bg-amber-500' : 'bg-violet-500'
                    }`}
                    style={{ width: `${Math.min(100, (dailySpend / 40000) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 italic">
                  * Dynamic limit set to protect users. Capped at 40,000 per day.
                </p>
              </div>

              {/* Packs Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {COIN_PACKS.map((pack) => {
                  const isSelected = selectedPack.id === pack.id;
                  const wouldExceed = dailySpend + pack.finalPriceINR > 40000;
                  const basePrice = convertPrice(pack.basePriceINR, currencyCode);
                  const finalPrice = convertPrice(pack.finalPriceINR, currencyCode);
                  return (
                    <button
                      key={pack.id}
                      onClick={() => {
                        if (!wouldExceed) {
                          setSelectedPack(pack);
                        }
                      }}
                      disabled={wouldExceed}
                      className={`flex flex-col justify-between p-4 rounded-xl border text-left transition-all relative overflow-hidden cursor-pointer ${
                        wouldExceed 
                          ? 'border-white/2 opacity-40 cursor-not-allowed bg-slate-950/20' 
                          : isSelected
                            ? 'border-amber-500 bg-amber-500/5 shadow-md shadow-amber-500/5'
                            : 'border-white/5 bg-slate-900/40 hover:bg-slate-900/60 hover:border-white/10'
                      }`}
                    >
                      {/* Coins Indicator */}
                      <div className="flex items-center space-x-2">
                        <img src={pack.imagePath} alt="Coin Pack" className="w-8 h-8 object-contain shrink-0" />
                        <span className="text-sm font-bold text-slate-200 font-mono">
                          {pack.coins.toLocaleString()}
                        </span>
                      </div>
                      
                      {/* Discount & Base Price */}
                      <div className="mt-3 flex items-center space-x-2">
                        <span className="text-[10px] text-slate-500 line-through font-mono">
                          {currentCurrency.symbol}{basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 py-0.2 rounded font-bold">
                          {pack.discountRate}
                        </span>
                      </div>

                      {/* Price Display */}
                      <div className="mt-1 flex items-baseline justify-between w-full">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Final Price</span>
                        <span className="text-base font-black text-amber-400 font-mono">
                          {currentCurrency.symbol}{finalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>

                      {wouldExceed && (
                        <div className="absolute top-1.5 right-1.5" title="Exceeds daily spend limit">
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Checkout actions */}
              <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-500">Selected Pack:</span>
                  <p className="text-sm font-bold text-white">
                    {selectedPack.coins.toLocaleString()} Coins for <span className="text-amber-400 font-mono">{currentCurrency.symbol}{convertPrice(selectedPack.finalPriceINR, currencyCode).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </p>
                </div>
                <button
                  onClick={() => setCheckoutStep('checkout')}
                  disabled={isCapExceeded}
                  className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 px-6 py-3 rounded-xl font-bold shadow-lg shadow-amber-500/15 transition-all cursor-pointer border border-amber-400/20 text-sm flex items-center space-x-2"
                >
                  <CreditCard className="w-4 h-4 text-slate-950 stroke-[2.5]" />
                  <span>Secure Pay</span>
                </button>
              </div>
            </>
          )}

          {checkoutStep === 'checkout' && (
            <div className="space-y-4 animate-fade-in">
              {/* Order summary card */}
              <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <img src={selectedPack.imagePath} alt="Coins" className="w-10 h-10 object-contain shrink-0" />
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      {selectedPack.coins.toLocaleString()} Coins Pack
                    </h4>
                    <p className="text-[10px] text-slate-400">Order ID: {selectedPack.id}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 uppercase block tracking-wider font-semibold">Total Due</span>
                  <span className="text-base font-black text-amber-400 font-mono">
                    {currentCurrency.symbol}{convertPrice(selectedPack.finalPriceINR, currencyCode).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Razorpay Button Container */}
              <div className="bg-slate-950/40 border border-white/5 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[180px] relative">
                {!isRazorpaySdkLoaded && !razorpayError && (
                  <div className="flex flex-col items-center space-y-3 py-6">
                    <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-slate-400 font-medium">Initializing Razorpay secure gateway...</span>
                  </div>
                )}

                {razorpayError && (
                  <div className="flex items-center gap-2 bg-red-950/20 border border-red-500/10 rounded-xl p-4 text-xs text-red-400 w-full">
                    <AlertTriangle className="w-4 h-4 shrink-0 animate-pulse" />
                    <span>{razorpayError}</span>
                  </div>
                )}

                {isRazorpaySdkLoaded && !razorpayError && (
                  <div className="w-full flex flex-col items-center justify-center space-y-4">
                    <p className="text-xs text-slate-400 text-center font-medium">
                      Press the button below to open the secure Razorpay payment window.
                    </p>
                    <button
                      onClick={initiatePayment}
                      className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 py-3 rounded-xl font-bold transition-all border border-amber-400/20 cursor-pointer shadow-lg shadow-amber-500/10 text-center text-sm flex items-center justify-center space-x-2 animate-fade-in"
                    >
                      <CreditCard className="w-4 h-4 stroke-[2.5]" />
                      <span>Pay with Razorpay</span>
                    </button>
                  </div>
                )}
              </div>

              {errorMessage && (
                <div className="flex items-center gap-2 bg-red-950/20 border border-red-500/10 rounded-xl p-3 text-xs text-red-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 animate-pulse" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setCheckoutStep('selection')}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold py-3 rounded-xl transition-all border border-white/5 cursor-pointer text-center"
                >
                  Cancel & Go Back
                </button>
              </div>
            </div>
          )}

          {checkoutStep === 'processing' && (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold text-slate-200">Processing Payment Securing...</p>
                <p className="text-[10px] text-slate-500">Connecting to payment gateway server. Do not reload or close this window.</p>
              </div>
            </div>
          )}

          {checkoutStep === 'success' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 animate-bounce">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              
              <div className="space-y-2">
                <h4 className="text-xl font-bold text-white">Purchase Successful!</h4>
                <p className="text-sm text-slate-300 max-w-sm">
                  Successfully purchased <strong className="text-emerald-400 font-mono">{selectedPack.coins.toLocaleString()} Coins</strong>. Your wallet has been updated.
                </p>
              </div>

              <div className="bg-slate-900/60 border border-white/5 rounded-xl px-5 py-3 w-full max-w-md space-y-1.5 text-xs font-mono">
                <div className="flex justify-between text-slate-500">
                  <span>Transaction ID:</span>
                  <span className="text-slate-300 text-right select-all">{successTxId}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Amount Paid:</span>
                  <span className="text-slate-300 text-right">{currentCurrency.symbol}{convertPrice(selectedPack.finalPriceINR, currencyCode).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Currency:</span>
                  <span className="text-slate-300 text-right">{currentCurrency.code}</span>
                </div>
              </div>

              <button
                onClick={() => {
                  setCheckoutStep('selection');
                  onClose();
                }}
                className="w-full max-w-xs bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-3 rounded-xl transition-all cursor-pointer"
              >
                Return to Dashboard
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
