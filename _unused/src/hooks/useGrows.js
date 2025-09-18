import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection,
  query as fsQuery,
  orderBy,
  getDocs,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase-config";

const growsKey = (uid) => ["grows", uid || "anon"];
const col = (uid) => collection(db, `users/${uid}/grows`);

export function useGrows(uidProp) {
  const uid = uidProp || auth.currentUser?.uid || null;
  const queryClient = useQueryClient();
  const key = useMemo(() => growsKey(uid), [uid]);

  const qFn = async () => {
    if (!uid) return [];
    const q = fsQuery(col(uid), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  };

  const query = useQuery({
    queryKey: key,
    queryFn: qFn,
    enabled: !!uid,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!uid) return;
    const q = fsQuery(col(uid), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      queryClient.setQueryData(key, rows);
    });
    return () => unsub();
  }, [uid, queryClient, key]);

  const addGrow = useMutation({
    mutationFn: async (payload) => {
      if (!uid) throw new Error("Not signed in");
      const ref = await addDoc(col(uid), { ...payload, createdAt: serverTimestamp() });
      return { id: ref.id, ...payload };
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData(key) || [];
      const temp = { id: `temp-${Date.now()}`, ...payload, _optimistic: true };
      queryClient.setQueryData(key, [temp, ...prev]);
      return { prev };
    },
    onError: (_e, _p, ctx) => { if (ctx?.prev) queryClient.setQueryData(key, ctx.prev); },
    onSuccess: (data) => {
      const current = queryClient.getQueryData(key) || [];
      queryClient.setQueryData(key, [data, ...current.filter((g) => !g._optimistic)]);
    },
  });

  const updateGrow = useMutation({
    mutationFn: async ({ id, patch }) => {
      if (!uid || !id) throw new Error("Missing uid or id");
      await updateDoc(doc(db, `users/${uid}/grows/${id}`), patch);
      return { id, patch };
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData(key) || [];
      queryClient.setQueryData(key, prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(key, ctx.prev); },
  });

  const deleteGrow = useMutation({
    mutationFn: async (id) => {
      if (!uid || !id) throw new Error("Missing uid or id");
      await deleteDoc(doc(db, `users/${uid}/grows/${id}`));
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData(key) || [];
      queryClient.setQueryData(key, prev.filter((g) => g.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => { if (ctx?.prev) queryClient.setQueryData(key, ctx.prev); },
  });

  return {
    ...query,
    addGrow: addGrow.mutateAsync,
    updateGrow: updateGrow.mutateAsync,
    deleteGrow: deleteGrow.mutateAsync,
  };
}
