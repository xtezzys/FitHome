import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import './auth.css';

/**
 * Экран регистрации (docs/design.md §2: /register — публичный, §6.1: поток
 * регистрация → дашборд). Inline-валидация + ошибка сервера docs/api.md §1.
 */
export function RegisterPage() {
  const { register, error: authError } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
  }>({});
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const errors: { name?: string; email?: string; password?: string } = {};
    if (name.trim().length === 0 || name.trim().length > 50) {
      errors.name = 'Введите имя (до 50 символов)';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Введите корректный email';
    }
    if (password.length < 8 || password.length > 72) {
      errors.password = 'Пароль должен содержать от 8 до 72 символов';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validate()) return;
    setLoading(true);
    const success = await register(email.trim(), password, name.trim());
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
        <h2 className="auth__title">Регистрация</h2>

        {authError && (
          <p className="auth__server-error" role="alert">
            {authError}
          </p>
        )}

        <TextField
          label="Имя"
          type="text"
          name="name"
          autoComplete="name"
          placeholder="Алексей"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name}
        />
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
          autoComplete="new-password"
          placeholder="Минимум 8 символов"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />

        <Button type="submit" loading={loading}>
          Создать аккаунт
        </Button>

        <p className="auth__switch">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </form>
    </main>
  );
}
