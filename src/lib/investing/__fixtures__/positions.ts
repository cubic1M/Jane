// Positions files following each brokerage's published layout, with invented numbers.

export const fidelity = [
  "Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Today's Gain/Loss Dollar,Today's Gain/Loss Percent,Total Gain/Loss Dollar,Total Gain/Loss Percent,Percent Of Account,Cost Basis Total,Average Cost Basis,Type",
  'X12345678,Individual,FXAIX,FIDELITY 500 INDEX FUND,100.5,$185.23,+$1.22,"$18,616.22",+$122.61,+0.66%,"+$4,616.22",+32.98%,92.10%,"$14,000.00",$139.30,Cash',
  "X12345678,Individual,AAPL,APPLE INC,10,$230.00,-$1.00,$2300.00,-$10.00,-0.43%,+$300.00,+15.00%,7.90%,$2000.00,$200.00,Cash",
  "X12345678,Individual,SPAXX**,HELD IN MONEY MARKET,,,,$500.00,,,,,,,,Cash",
  "Z98765432,Roth IRA,VTI,VANGUARD TOTAL STOCK MARKET ETF,20,$300.00,+$2.00,$6000.00,+$40.00,+0.67%,+$500.00,+9.09%,100%,$5500.00,$275.00,Cash",
  "",
  '"The data and information in this spreadsheet is provided to you solely for your use and is not for distribution."',
].join("\n");

export const schwab = [
  '"Positions for account Individual ...123 as of 10:15 AM ET, 2026/10/20"',
  "",
  '"Symbol","Description","Quantity","Price","Price Change %","Price Change $","Market Value","Day Change %","Day Change $","Cost Basis","Gain/Loss $","Gain/Loss %","Ratings","Reinvest Dividends?","Capital Gains?","% Of Account","Security Type"',
  '"SCHB","SCHWAB US BROAD MARKET ETF","50","$24.00","0.5%","$0.12","$1,200.00","0.5%","$6.00","$1,000.00","$200.00","20%","--","No","N/A","60%","ETF"',
  '"SCHX","SCHWAB US LARGE-CAP ETF","20","$40.00","0.1%","$0.04","$800.00","0.1%","$0.80","$900.00","-$100.00","-11.1%","--","No","N/A","40%","ETF"',
  '"Cash & Cash Investments","--","--","--","0%","$0.00","$250.00","0%","$0.00","--","--","--","--","--","--","10%","Cash and Money Market"',
  '"Account Total","--","--","--","0%","$0.00","$2,250.00","0%","$0.00","--","--","--","--","--","--","--","--"',
].join("\n");

export const vanguard = [
  "Account Number,Investment Name,Symbol,Shares,Share Price,Total Value",
  "11112222,VANGUARD TOTAL STOCK MARKET INDEX ADMIRAL,VTSAX,12.345,$130.50,$1611.02",
  "11112222,VANGUARD FEDERAL MONEY MARKET INVESTOR,VMFXX,300,$1.00,$300.00",
  "",
  "Account Number,Trade Date,Settlement Date,Transaction Type,Transaction Description,Investment Name,Symbol,Shares,Share Price,Principal Amount,Commissions and Fees,Net Amount,Accrued Interest,Account Type",
  "11112222,2026-09-01,2026-09-01,Buy,Buy,VANGUARD TOTAL STOCK MARKET INDEX ADMIRAL,VTSAX,1,$120.00,-$120.00,$0.00,-$120.00,0,CASH",
].join("\n");

export const robinhood = [
  "Instrument,Quantity,Average Cost,Price,Equity,Total Return",
  "TSLA,2,$180.00,$250.00,$500.00,+$140.00",
  "VOO,1.5,$400.00,$450.00,$675.00,+$75.00",
].join("\n");
