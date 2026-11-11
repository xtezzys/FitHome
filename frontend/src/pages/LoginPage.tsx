import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import './auth.css';

/**
 * Экран входа (docs/design.md §2: /login — публичный).
 * Inline-валидация полей + ошибка сервера в едином формате docs/api.md §1.
 */
export function LoginPage() {
  const { login, error: authError } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const errors: { email?: string; password?: string } = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Введите корректный email';
    }
    if (password.length < 8) {
      errors.password = 'Пароль должен содержать минимум 8 символов';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validate()) return;
    setLoading(true);
    const success = await login(email.trim(), password);
    setLoading(false);
    if (success) {
      navigate('/', { replace: true });
    }
  }

  return (
    <main className="auth">
      <h1 className="auth__logo">FitHome</h1>
      <p className="auth__tagline">Планирование тренировок дома, на улице и в зале</p>
      <form className="auth__card" onSubmit={handleSubmit} noValidate>
        <h2 className="auth__title">Вход</h2>

        {authError && (
          <p className="auth__server-error" role="alert">
            {authError}
          </p>
        )}

        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <TextField
          label="Пароль"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Минимум 8 символов"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />

        <Button type="submit" loading={loading}>
          Войти
        </Button>

        <p className="auth__switch">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </form>
    </main>
  );
}
