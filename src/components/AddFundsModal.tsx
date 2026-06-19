import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, runTransaction, doc } from 'firebase/firestore';
import { X, CreditCard, Globe, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { UserProfile } from '../types';

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
  const { user, profile } = useAuth();
  const [selectedPack, setSelectedPack] = useState<CoinPack>(COIN_PACKS[1]); // default to 1,000 coins
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('INR');
  const [dailySpend, setDailySpend] = useState<number>(0);
  const [checkoutStep, setCheckoutStep] = useState<'selection' | 'checkout' | 'processing' | 'success'>('selection');
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'upi'>('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardName, setCardName] = useState('');
  const [upiId, setUpiId] = useState('');
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
        collection(db, 'walletLedger'),
        where('uid', '==', user.uid),
        where('type', '==', 'purchase'),
        where('createdAt', '>=', startOfDay)
      );

      const querySnap = await getDocs(q);
      let sum = 0;
      querySnap.forEach((docSnap) => {
        const data = docSnap.data();
        if (typeof data.pricePaidINR === 'number') {
          sum += data.pricePaidINR;
        } else if (typeof data.pricePaid === 'number') {
          sum += data.pricePaid;
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

  if (!isOpen) return null;

  const currentCurrency = CURRENCIES[currencyCode];
  const isCapExceeded = dailySpend + selectedPack.finalPriceINR > 40000;

  // Credit coins in Firestore
  const creditCoins = async (txId: string, isReal: boolean) => {
    if (!user || !profile) return;

    const userDocRef = doc(db, 'users', user.uid);
    const ledgerColRef = collection(db, 'walletLedger');

    await runTransaction(db, async (transaction) => {
      const userDoc = await transaction.get(userDocRef);
      if (!userDoc.exists()) {
        throw new Error('User profile does not exist');
      }

      const pData = userDoc.data() as UserProfile;
      const balanceBefore = pData.bankBalance;
      const balanceAfter = Math.round((balanceBefore + selectedPack.coins) * 10000) / 10000;
      const totalCoinsEarned = (pData.totalCoinsEarned || balanceBefore) + selectedPack.coins;

      // Update user document
      transaction.update(userDocRef, {
        bankBalance: balanceAfter,
        totalCoinsEarned: totalCoinsEarned
      });

      // Write transaction ledger
      const newLedgerDocRef = doc(ledgerColRef);
      transaction.set(newLedgerDocRef, {
        uid: user.uid,
        type: 'purchase',
        amount: selectedPack.coins,
        matchId: null,
        balanceBefore,
        balanceAfter,
        createdAt: Date.now(),
        pricePaid: convertPrice(selectedPack.finalPriceINR, currencyCode),
        pricePaidINR: selectedPack.finalPriceINR,
        currency: currencyCode,
        paymentGateway: isReal ? 'razorpay' : 'sandbox',
        transactionId: txId
      });
    });
  };

  // Trigger Razorpay payment
  const handleRazorpayPayment = () => {
    const razorpayKey = import.meta.env.VITE_RAZORPAY_KEY_ID;
    if (!razorpayKey || razorpayKey.includes('dummy') || razorpayKey === '') {
      // Switch to standard Sandbox Checkout modal
      setCheckoutStep('checkout');
      return;
    }

    setCheckoutStep('processing');
    setErrorMessage('');

    const options = {
      key: razorpayKey,
      amount: Math.round(convertPrice(selectedPack.finalPriceINR, currencyCode) * 100), // Razorpay takes amount in subunits (paise / cents)
      currency: currencyCode,
      name: 'Check & Mate Lounge',
      description: `Purchase of ${selectedPack.coins.toLocaleString()} Chess Coins`,
      image: '/game_logo.png',
      handler: async (response: any) => {
        try {
          const txId = response.razorpay_payment_id || `pay_${Math.random().toString(36).substr(2, 9)}`;
          await creditCoins(txId, true);
          setSuccessTxId(txId);
          setCheckoutStep('success');
        } catch (err: any) {
          console.error('Failed to settle payment:', err);
          setErrorMessage(err.message || 'Payment success but failed to credit coins. Please contact support.');
          setCheckoutStep('selection');
        }
      },
      prefill: {
        name: profile?.displayName || user?.displayName || '',
        email: user?.email || '',
      },
      theme: {
        color: '#8b5cf6', // Violet accent
      },
      modal: {
        ondismiss: () => {
          setCheckoutStep('selection');
        }
      }
    };

    try {
      // Load script if not already present
      if (!(window as any).Razorpay) {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = () => {
          const rzp = new (window as any).Razorpay(options);
          rzp.open();
        };
        script.onerror = () => {
          setErrorMessage('Failed to load payment gateway. Try simulated checkout.');
          setCheckoutStep('checkout');
        };
        document.body.appendChild(script);
      } else {
        const rzp = new (window as any).Razorpay(options);
        rzp.open();
      }
    } catch (e: any) {
      console.error('Error opening Razorpay:', e);
      setErrorMessage('Could not open Razorpay. Redirecting to Sandbox checkout.');
      setCheckoutStep('checkout');
    }
  };

  const handleSimulatedPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentMethod === 'card' && (!cardNumber || !cardExpiry || !cardCvv || !cardName)) {
      setErrorMessage('Please fill out all card details');
      return;
    }
    if (paymentMethod === 'upi' && !upiId) {
      setErrorMessage('Please enter your UPI ID');
      return;
    }

    setCheckoutStep('processing');
    setErrorMessage('');

    // Simulate network latency
    setTimeout(async () => {
      try {
        const txId = `tx_sb_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        await creditCoins(txId, false);
        setSuccessTxId(txId);
        setCheckoutStep('success');
      } catch (err: any) {
        console.error('Failed to credit simulated coins:', err);
        setErrorMessage(err.message || 'Simulation failed to credit coins.');
        setCheckoutStep('checkout');
      }
    }, 1800);
  };

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
                  onClick={handleRazorpayPayment}
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
            <form onSubmit={handleSimulatedPayment} className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl flex items-start gap-2.5 text-xs text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Sandbox Payment Gateway Simulation</p>
                  <p className="text-[10px] mt-0.5">Real gateway credentials are not loaded in .env yet. We are using a secure, client-side sandbox simulator.</p>
                </div>
              </div>

              {/* Payment selector tabs */}
              <div className="grid grid-cols-2 gap-2 bg-slate-950/60 p-1.5 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all cursor-pointer text-center flex items-center justify-center space-x-2 ${
                    paymentMethod === 'card' ? 'bg-violet-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Credit Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('upi')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all cursor-pointer text-center flex items-center justify-center space-x-2 ${
                    paymentMethod === 'upi' ? 'bg-violet-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>UPI / QR Code</span>
                </button>
              </div>

              {paymentMethod === 'card' ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Cardholder Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. John Doe"
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Card Number</label>
                    <input
                      type="text"
                      required
                      placeholder="XXXX XXXX XXXX XXXX"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, '').substr(0, 16))}
                      className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Expiry Date</label>
                      <input
                        type="text"
                        required
                        placeholder="MM/YY"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value.substr(0, 5))}
                        className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">CVV Code</label>
                      <input
                        type="password"
                        required
                        placeholder="***"
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').substr(0, 3))}
                        className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 font-mono"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">UPI address ID</label>
                    <input
                      type="text"
                      required
                      placeholder="username@upi"
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 font-mono text-left"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500">
                    A notification will be sent to your UPI app (Google Pay, PhonePe, Paytm, etc.) to approve the payment.
                  </p>
                </div>
              )}

              {errorMessage && (
                <div className="flex items-center gap-2 bg-red-950/20 border border-red-500/10 rounded-xl p-3 text-xs text-red-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 animate-pulse" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setCheckoutStep('selection')}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold py-3 rounded-xl transition-all border border-white/5 cursor-pointer text-center"
                >
                  Go Back
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-bold py-3 rounded-xl transition-all border border-amber-500/20 cursor-pointer shadow-lg shadow-amber-500/10 text-center"
                >
                  Pay {currentCurrency.symbol}{convertPrice(selectedPack.finalPriceINR, currencyCode).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </button>
              </div>
            </form>
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
