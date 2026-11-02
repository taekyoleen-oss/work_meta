// 공개해도 되는 앱 설정만 내려준다. 계정 이메일은 저장소에 두지 않고 Vercel 환경 변수로 넣는다.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
    driveAccounts: (process.env.DRIVE_ACCOUNTS ?? '').split(',').map((s) => s.trim()),
  });
}
