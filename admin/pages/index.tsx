import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { authService } from '../services/authService';
import Loader from '../components/UI/Loader';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Check if user is authenticated
    if (authService.isAuthenticated() && authService.isAdmin()) {
      // Redirect to dashboard if authenticated
      router.replace('/dashboard');
    } else {
      // Redirect to login if not authenticated
      router.replace('/login');
    }
  }, [router]);

  // Show loader while redirecting
  return <Loader />;
}
