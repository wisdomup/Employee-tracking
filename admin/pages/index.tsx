import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { authService } from '../services/authService';
import Loader from '../components/UI/Loader';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (authService.isAuthenticated()) {
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [router]);

  // Show loader while redirecting
  return <Loader />;
}
