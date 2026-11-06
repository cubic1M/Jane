// Synthetic text layers of tax forms, made up (no real person, employer or account), in the
// layouts issuers use: the box's amount on the label's line, or on the next line, and a broker's
// consolidated 1099 that names the box after the label. Each carries the kind of personal data a
// real form does, so a test can check none of it comes out.

export const W2_SAME_LINE = `Form W-2 Wage and Tax Statement 2025
a Employee's social security number 123-45-6789
b Employer identification number (EIN) 12-3456789
c Employer's name, address, and ZIP code  EXAMPLE WIDGETS INC 1 MAIN ST ANYTOWN ZZ 00000
e Employee's first name and initial Last name  JORDAN SAMPLE
1 Wages, tips, other compensation 61,240.00   2 Federal income tax withheld 6,120.50
3 Social security wages 64,000.00   4 Social security tax withheld 3,968.00
5 Medicare wages and tips 64,000.00   6 Medicare tax withheld 928.00
15 State ZZ   16 State wages, tips, etc. 61,240.00   17 State income tax 2,450.10
`;

export const W2_NEXT_LINE = `Wage and Tax Statement   Form W-2   2025
Employee SSN: XXX-XX-6789
1 Wages, tips, other compensation
$48,000.00
2 Federal income tax withheld
$4,200.00
`;

export const NEC = `Form 1099-NEC 2025 Nonemployee Compensation
PAYER'S TIN 98-7654321  RECIPIENT'S TIN ***-**-6789
RECIPIENT'S name JORDAN SAMPLE  Account number 00012345
1 Nonemployee compensation $12,500.00
4 Federal income tax withheld $0.00
`;

export const INT = `Form 1099-INT 2025 Interest Income
PAYER: EXAMPLE SAVINGS BANK   Account number ****4417
1 Interest income 843.27
`;

// A broker's consolidated 1099, padded so the dividend box comes well after the first page.
export const CONSOLIDATED = `EXAMPLE BROKERAGE  2025 Consolidated Form 1099
Account 5555-1234  JORDAN SAMPLE
${Array.from({ length: 60 }, (_, i) => `Summary note ${i + 1}: see instructions for recipient`).join("\n")}
1099-DIV Dividends and Distributions
Total Ordinary Dividends (1a) 1,204.11
Qualified Dividends (1b) 980.40
`;
